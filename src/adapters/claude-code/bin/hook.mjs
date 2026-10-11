#!/bin/sh
':' //; s="$0"; n=0; while [ -h "$s" ] && [ $n -lt 32 ]; do n=$((n+1)); l="$(readlink "$s")"; case "$l" in /*) s="$l" ;; *) s="${s%/*}/$l" ;; esac; done; c="${s%/*}/../../empty-bunfig.toml"; [ -f "$c" ] || c=/dev/null; if command -v bun >/dev/null 2>&1; then exec bun --no-env-file "--config=$c" "$0" "$@"; elif command -v node >/dev/null 2>&1; then exec node "$0" "$@"; else echo "counterparts: needs Bun 1.3+ or Node 22.15+ on PATH" >&2; exit 127; fi
// A shell script and an ES module at once: the line above is a no-op string to
// JavaScript and, to sh, the runtime choice (Bun if it is on PATH, else Node;
// Bun with --no-env-file and --config=<empty-bunfig.toml>, found through any
// bin symlink, so a project's .env and bunfig.toml stay out: adapters/runtime.ts).
// See `adapters/launch.mjs`.
import { launch } from "../../launch.mjs";

await launch(new URL("./hook.ts", import.meta.url));
