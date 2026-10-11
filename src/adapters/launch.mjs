/**
 * What the four installed commands (`package.json#bin`) run: start one of the
 * TypeScript entry points under whichever runtime the shell found.
 *
 * Each command is a small file that is a shell script AND an ES module (see
 * `cli/bin/counterparts.mjs`). The shell half picks the runtime — Bun when
 * `bun` is on PATH, which is what the `#!/usr/bin/env bun` shebang it replaced
 * did, else Node — and runs the same file with it; this half then loads Node's
 * TypeScript hooks when it is Node, and imports the entry.
 *
 * **THE OLD TARGETS STAY RUNNABLE.** Until 2026-10-01 the bins pointed straight
 * at `cli/bin/counterparts.ts`, `claude-code/bin/hook.ts`, `mcp/bin/serve.ts`
 * and `dashboard/bin/dashboard.ts`, and an upgrade (bun's above all) can leave
 * an existing bin symlink pointing at the `.ts` it was made for. So those four
 * keep their `#!/usr/bin/env bun` shebang and their exec bit;
 * `test/runtime.test.ts` holds both, so a tidy-up cannot break an install that
 * still links there.
 *
 * `process.argv[1]` is set to the entry's own path first: every entry runs only
 * when it is the main script (`isEntryPoint(process.argv[1], import.meta.url)`),
 * and from here the main script is this launcher.
 */
import { fileURLToPath } from "node:url";

/** @param {URL} entry */
export async function launch(entry) {
  if (process.versions.bun === undefined) await import("./node-hooks.mjs");
  process.argv[1] = fileURLToPath(entry);
  await import(entry.href);
}
