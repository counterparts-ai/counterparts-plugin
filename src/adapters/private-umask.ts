/**
 * THE LOCAL STORE IS PRIVATE TO ITS USER (2026-10-27, R1; Mike: "if there's
 * really no downside, just do that").
 *
 * Every one of our own processes (the console, the hooks, the MCP server, the
 * worker, the night, the dashboard) starts by setting the process umask to
 * `077`, so whatever it creates comes out `0700` for a directory and `0600`
 * for a file: the store and its `-wal`/`-shm`, snapshots, the journal, spans,
 * the cache, the sidebar's json, the log. It is the way `ssh` and Postgres
 * keep a data directory private, and it covers the ~75 places a file is
 * written without each one having to remember a mode.
 *
 * WHAT IT DOES NOT TOUCH:
 *   - **The core.** `core/` never calls this: an embedder's process umask is
 *     not ours to change. The core sets explicit modes on what matters most
 *     instead (`core/store/private.ts`): the database family, snapshot copies,
 *     the roots it creates.
 *   - **Another program's files.** A program that is not ours (`claude mcp
 *     add`, `claude -p`, the browser opener, `git`) is started under the
 *     umask the process was given (`withHostUmask`), so a file it writes (a
 *     stranger's `~/.claude.json`) gets the mode it always did.
 *   - **Our own children START under the host's umask too** (`spawn.ts#
 *     spawnDetached`, the plugin's first-run install, the plugin console's
 *     hand-off): each sets `077` itself in `start()`, and must find the
 *     host's umask there to record, or the night's `claude -p` would be
 *     handed `077` as if it were the host's (review of #657).
 *   - **A directory made outside our tree** (`~/.claude` by `connect`, Claude
 *     Desktop's config folder) is made under the host's umask.
 *   - **Files written with an explicit mode.** `wire.ts#writeSettings` keeps
 *     a settings file's own mode, and a new one is `0644` as before.
 *
 * It never loosens: the mask set is the one found OR'd with `077`.
 */

export const PRIVATE_UMASK = 0o077;

/** The umask this process was started with; null until `usePrivateUmask`. */
let hostUmask: number | null = null;

/** Set the private umask. Idempotent; a runtime without `umask` is left as it is. */
export function usePrivateUmask(): void {
  if (hostUmask !== null) return;
  try {
    const found = process.umask(PRIVATE_UMASK);
    hostUmask = found;
    if ((found | PRIVATE_UMASK) !== PRIVATE_UMASK) process.umask(found | PRIVATE_UMASK);
  } catch {
    // Windows, or a worker thread: modes are not ours to set there.
  }
}

/**
 * Run `fn` (a spawn of a program that is not ours) under the umask this
 * process was started with. The child takes its umask at fork, which happens
 * inside the synchronous `spawn`/`spawnSync` call, so this is right for an
 * asynchronous spawn too.
 */
export function withHostUmask<T>(fn: () => T): T {
  if (hostUmask === null) return fn();
  let prev: number | null = null;
  try {
    prev = process.umask(hostUmask);
  } catch {
    return fn();
  }
  try {
    return fn();
  } finally {
    process.umask(prev);
  }
}
