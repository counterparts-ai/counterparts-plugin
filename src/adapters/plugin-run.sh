#!/bin/sh
# The Claude Code plugin's launcher.
#
#   sh plugin-run.sh hook   - the five hooks (hooks/hooks.json)
#   sh plugin-run.sh mcp    - the memory server (.claude-plugin/plugin.json)
#   sh plugin-run.sh cli …  - the console, for a plugin user with no
#                             `counterparts` on PATH (commands/doctor.md,
#                             commands/dashboard.md)
#
# Claude Code runs this with `sh` and the absolute path, so it needs no exec
# bit and no runtime of its own. Its one job is the one the npm install does
# at `install` time and a plugin cannot: FIND A RUNTIME. The install writes the
# absolute path of the runtime it ran under into the host's configuration
# (cli/install.ts, scar 2.18: a host's PATH is not the login shell's); a
# plugin's command is fixed in a file we ship, so the search happens here, at
# every launch, in this order:
#
#   1. COUNTERPARTS_RUNTIME, when set: that executable and no other runtime
#      (Bun, Node, or a Counterparts single binary); one that is not there or
#      too old goes on to 4, not to 2 or 3.
#   2. Bun 1.3+: on PATH, then $BUN_INSTALL/bin, ~/.bun/bin, Homebrew.
#   3. Node 22.15+: on PATH, then Homebrew, /usr/local, Volta, nvm, fnm, asdf,
#      mise. A Node older than 22.15 is skipped, not run (it cannot load the
#      TypeScript sources: adapters/runtime.ts#NODE_FLOOR).
#   4. THE SINGLE BINARY (docs/single-binary.md): one prebuilt Counterparts
#      program for this platform and this exact version, kept in the plugin's
#      data directory, $CLAUDE_PLUGIN_DATA/bin/<version>/counterparts.
#
# Bun first, because that is what the npm bins do (cli/bin/counterparts.mjs).
# The entry it runs is the same one those bins run (hook.mjs, serve.mjs,
# counterparts.mjs), so the runtime choice is the only difference.
#
# Bun runs with --no-env-file and --config=<empty-bunfig.toml>: Claude Code
# starts the hooks and the server in the person's project, and Bun would
# otherwise load that project's .env into them (nothing pins the plugin
# server's COUNTERPARTS_DATA_DIR, so a project .env could name another store)
# and run its bunfig.toml `preload` inside them (adapters/runtime.ts). Node
# reads neither unless told to; the single binary is built with both off
# (--no-compile-autoload-dotenv, --no-compile-autoload-bunfig).
#
# That file also turns Bun's runtime auto-install off (`[install] auto =
# "disable"`), here and in every process these start: where no node_modules
# sits above the plugin (Claude Code's dependency install did not run: no npm,
# its time limit, offline), Bun would otherwise fetch the embedding table from
# the npm registry, unpinned, behind the person's back. Off, the table is simply
# missing, and doctor says so.
#
# WITH NONE OF THE FOUR, THIS FETCHES THE BINARY — once, in the background,
# under a lock, never blocking a hook or the server's start-up:
#
#   - The platform: macOS arm64 (`sysctl hw.optional.arm64`, which a shell
#     started under Rosetta still answers truthfully, unlike `uname -m`), macOS
#     x64, Linux x64/arm64 (glibc), Windows x64 — though no release offers
#     Windows one yet (tools/single-binary/build.ts#RELEASED), so there the
#     message still names a runtime to install.
#   - The program comes from this version's GitHub release: the URL is built
#     here from plugin.json's version and the platform, nothing else. Its
#     sha256s come from .claude-plugin/binaries.json: the checksums SHIP WITH
#     THE PLUGIN — a sum fetched from the same place as the file would prove
#     the transfer and nothing about where it came from. curl takes HTTPS only,
#     redirects included (GitHub sends release assets on to its own CDN, whose
#     host curl cannot pin and has changed before; the pinned sha256 is what
#     makes any host's bytes safe), and no more than the size binaries.json
#     names. The download is checked compressed and again unpacked, in a
#     directory only this user can enter, before it is made executable; only
#     then is it moved into place, in one rename. A file that fails either
#     check is deleted and never run.
#   - A KEPT PROGRAM IS NOT TRUSTED FOREVER. Every full check writes a stamp
#     beside it: the sha256 it matched, and the file's inode, size and mtime.
#     Each launch compares the stamp with binaries.json and the file (one
#     `stat`); the server's start (once a session), a stamp a day old, or any
#     difference re-hashes the whole file (50–80 ms for 100 MiB with openssl,
#     measured on an M3 Pro; a hook's own check is about 1 ms). A program
#     that no longer matches is deleted and downloaded again.
#   - Meanwhile SessionStart says, once, that Counterparts is getting ready
#     (the size, where it comes from, and that memory starts next session);
#     every other hook exits 0 in silence; the server answers the protocol
#     with no tools and says the same in its instructions. A failure gets one
#     line and is retried at a later start (not sooner than ten minutes).
#   - COUNTERPARTS_BINARY_DOWNLOAD=off forbids the download (the message then
#     names a runtime to install, as it did before the binary existed).
#     COUNTERPARTS_BINARY_URL replaces the release URL — for tests; the
#     checksums still come from the plugin.
#
# Claude Code's own native binary does not double as a JavaScript runtime
# (BUN_BE_BUN=1 is ignored; measured on 2.1.295).
#
# Shell built-ins and parameter expansion for everything up to the message,
# plus the runtimes' own --version; the download alone needs curl, gunzip and
# a sha256 tool, and says so by name when one is missing.

mode="${1:-}"
[ $# -gt 0 ] && shift

here="${0%/*}"
[ "$here" = "$0" ] && here="."
root="$here/../.."

case "$mode" in
  hook) entry="$here/claude-code/bin/hook.mjs" ;;
  mcp) entry="$here/mcp/bin/serve.mjs" ;;
  cli)
    entry="$here/cli/bin/counterparts.mjs"
    # The console launched FROM THE PLUGIN says so: a Bash call (the plugin's
    # /counterparts:doctor) carries no CLAUDE_PLUGIN_ROOT of its own, and doctor
    # needs to know it is the plugin's copy (adapters/plugin.ts#pluginDoctorLine).
    CLAUDE_PLUGIN_ROOT="$(cd "$here/../.." && pwd -P)"
    export CLAUDE_PLUGIN_ROOT
    ;;
  __fetch) entry="" ;;
  *)
    echo "counterparts plugin-run: usage: sh plugin-run.sh hook|mcp|cli [args]" >&2
    exit 2
    ;;
esac

runtime=""
kind=""

# version_at_least <version> <major> <minor>  (a leading "v" is ignored)
version_at_least() {
  v="${1#v}"
  major="${v%%.*}"
  rest="${v#*.}"
  minor="${rest%%.*}"
  minor="${minor%%-*}"
  case "$major" in "" | *[!0-9]*) return 1 ;; esac
  case "$minor" in "" | *[!0-9]*) return 1 ;; esac
  [ "$major" -gt "$2" ] && return 0
  [ "$major" -eq "$2" ] && [ "$minor" -ge "$3" ] && return 0
  return 1
}

try_bun() {
  [ -n "$1" ] && [ -x "$1" ] || return 1
  v="$("$1" --version 2>/dev/null)" || return 1
  version_at_least "$v" 1 3 || return 1
  runtime="$1"
  kind="bun"
}

try_node() {
  [ -n "$1" ] && [ -x "$1" ] || return 1
  v="$("$1" --version 2>/dev/null)" || return 1
  version_at_least "$v" 22 15 || return 1
  runtime="$1"
  kind="node"
}

try_node_glob() { # a glob of node binaries: the first that is new enough
  for candidate in "$@"; do
    try_node "$candidate" && return 0
  done
  return 1
}

if [ "$mode" != "__fetch" ]; then
  if [ -n "${COUNTERPARTS_RUNTIME:-}" ]; then
    case "${COUNTERPARTS_RUNTIME##*/}" in
      node*) try_node "$COUNTERPARTS_RUNTIME" ;;
      counterparts | counterparts.exe | counterparts-*)
        [ -x "$COUNTERPARTS_RUNTIME" ] && exec "$COUNTERPARTS_RUNTIME" "$mode" "$@"
        ;;
      *) try_bun "$COUNTERPARTS_RUNTIME" ;;
    esac
  else
    try_bun "$(command -v bun 2>/dev/null)" ||
      try_bun "${BUN_INSTALL:-$HOME/.bun}/bin/bun" ||
      try_bun "$HOME/.bun/bin/bun" ||
      try_bun /opt/homebrew/bin/bun ||
      try_bun /usr/local/bin/bun ||
      try_node "$(command -v node 2>/dev/null)" ||
      try_node /opt/homebrew/bin/node ||
      try_node /usr/local/bin/node ||
      try_node /usr/bin/node ||
      try_node "$HOME/.volta/bin/node" ||
      try_node_glob "$HOME"/.nvm/versions/node/v*/bin/node ||
      try_node_glob "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node ||
      try_node_glob "$HOME/Library/Application Support/fnm/node-versions"/*/installation/bin/node ||
      try_node_glob "$HOME"/.asdf/installs/nodejs/*/bin/node ||
      try_node_glob "$HOME"/.local/share/mise/installs/node/*/bin/node
  fi

  if [ "$kind" = "bun" ]; then
    exec "$runtime" --no-env-file "--config=$here/empty-bunfig.toml" "$entry" "$@"
  fi
  if [ -n "$runtime" ]; then
    exec "$runtime" "$entry" "$@"
  fi
fi

# ── the single binary ───────────────────────────────────────────────────────

# "key": value out of one line of JSON, by parameter expansion.
json_field() { # json_field <line> <key>
  case "$1" in *"\"$2\": "*) ;; *) return 1 ;; esac
  jv="${1#*\"$2\": }"
  jv="${jv#\"}"
  jv="${jv%%[\",\}]*}"
  printf '%s' "$jv"
}

platform=""
exe=""
why="" # set when there is no binary to be had, in words
os="$(uname -s 2>/dev/null)"
case "$os" in
  Darwin)
    # By its full path: a host's PATH need not carry /usr/sbin, and an Apple
    # silicon Mac that could not ask would be sent the Intel program.
    arm="$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || sysctl -n hw.optional.arm64 2>/dev/null)"
    [ -z "$arm" ] && [ "$(uname -m 2>/dev/null)" = "arm64" ] && arm="1"
    if [ "$arm" = "1" ]; then platform="darwin-arm64"; else platform="darwin-x64"; fi
    ;;
  Linux)
    if ls /lib/ld-musl-* >/dev/null 2>&1; then
      why="no prebuilt program for musl Linux (Alpine)"
    else
      case "$(uname -m 2>/dev/null)" in
        x86_64 | amd64) platform="linux-x64" ;;
        aarch64 | arm64) platform="linux-arm64" ;;
        *) why="no prebuilt program for this processor" ;;
      esac
    fi
    ;;
  MINGW* | MSYS* | CYGWIN*) platform="windows-x64" exe=".exe" ;;
  *) why="no prebuilt program for this system" ;;
esac

data="${CLAUDE_PLUGIN_DATA:-}"
# `/counterparts:doctor` runs this through Claude Code's Bash tool, whose
# environment need not carry CLAUDE_PLUGIN_DATA: then the directory Claude
# Code gives this plugin (`<config dir>/plugins/data/<name>-<marketplace>`),
# if it is there.
if [ -z "$data" ] && [ -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/data/counterparts-counterparts" ]; then
  data="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/data/counterparts-counterparts"
fi
[ -z "$data" ] && [ -z "$why" ] && why="the plugin has no data directory to keep it in"
case "${COUNTERPARTS_BINARY_DOWNLOAD:-}" in off | 0 | no | false) [ -z "$why" ] && why="COUNTERPARTS_BINARY_DOWNLOAD is off" ;; esac

version=""
manifest="$root/.claude-plugin/binaries.json"
if [ -r "$root/.claude-plugin/plugin.json" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    v="$(json_field "$line" version)" && { version="$v"; break; }
  done <"$root/.claude-plugin/plugin.json"
fi

case "$version" in "" | *[!0-9A-Za-z.+-]*) [ -z "$why" ] && why="the plugin names no usable version" ;; esac

sha=""
gzsha=""
gzbytes=""
if [ -z "$why" ]; then
  if [ ! -r "$manifest" ]; then
    why="this version of the plugin carries no prebuilt program"
  else
    mversion=""
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        *'"version": '*) mversion="$(json_field "$line" version)" ;;
        *"\"$platform\": "*)
          sha="$(json_field "$line" sha256)"
          gzsha="$(json_field "$line" gzSha256)"
          gzbytes="$(json_field "$line" gzBytes)"
          ;;
      esac
    done <"$manifest"
    if [ "$mversion" != "$version" ]; then
      why="no prebuilt program was published for version $version"
    elif [ -z "$sha" ] || [ -z "$gzsha" ]; then
      case "$platform" in
        windows-*) why="no prebuilt program for Windows yet" ;;
        *) why="no prebuilt program for $platform" ;;
      esac
    fi
  fi
fi
# The release's URL and the asset's name, from the version and platform alone
# (binaries.json's own "url" and "file" say the same, for verify-release.ts).
# COUNTERPARTS_BINARY_URL is for tests; the checksums still come from the plugin.
url="https://github.com/mlapeter/counterparts/releases/download/v$version"
asset="counterparts-$version-$platform$exe.gz"
[ -n "${COUNTERPARTS_BINARY_URL:-}" ] && url="${COUNTERPARTS_BINARY_URL%/}"

bindir="$data/bin"
bin="$bindir/$version/counterparts$exe"
verified="$bindir/$version/verified" # "<sha256> <inode> <size> <mtime>", written by a full check
lock="$bindir/download-$version.lock"
failed="$bindir/download-$version.failed"

sha256_of() { # the hex digest of a file, or nothing (fastest tool first)
  # The file on stdin, so no tool prints (or escapes) its name: GNU sha256sum
  # puts a backslash before the digest of a path that has one in it.
  if [ ! -r "$1" ]; then
    d=""
  elif command -v sha256sum >/dev/null 2>&1; then
    d="$(sha256sum <"$1" 2>/dev/null)"
  elif command -v openssl >/dev/null 2>&1; then
    d="$(openssl dgst -sha256 -r <"$1" 2>/dev/null)"
  elif command -v shasum >/dev/null 2>&1; then
    d="$(shasum -a 256 <"$1" 2>/dev/null)"
  else
    d=""
  fi
  printf '%s' "${d%% *}"
}

stat_of() { # "<inode> <size> <mtime>" of a file, or nothing
  # macOS's own stat, by its full path: GNU coreutils' (Homebrew's gnubin,
  # first on PATH) reads -f as --file-system, and no stamp would ever match.
  case "$os" in
    Darwin) /usr/bin/stat -f '%i %z %m' "$1" 2>/dev/null ;;
    *) stat -c '%i %s %Y' "$1" 2>/dev/null ;;
  esac
}

# Stamp the program as checked against $sha, in one rename.
stamp_verified() {
  s="$(stat_of "$bin")"
  [ -n "$s" ] || return 0
  printf '%s %s\n' "$sha" "$s" >"$verified.$$" 2>/dev/null && mv -f "$verified.$$" "$verified" 2>/dev/null
  rm -f "$verified.$$" 2>/dev/null
}

# ── a program already here: run it, checked ─────────────────────────────────
if [ -z "$why" ] && [ "$mode" != "__fetch" ] && [ -f "$bin" ]; then
  stamp=""
  [ -r "$verified" ] && IFS= read -r stamp <"$verified"
  now="$(stat_of "$bin")"
  # Fast path, every hook: the stamp names THIS plugin's checksum and this very
  # file (same inode, size, mtime), and is under a day old.
  if [ "$mode" != "mcp" ] && [ -n "$now" ] && [ "$stamp" = "$sha $now" ] && [ -x "$bin" ] &&
    [ -z "$(find "$verified" -mmin +1440 2>/dev/null)" ]; then
    exec "$bin" "$mode" "$@"
  fi
  # The server's start, an old or missing stamp, or a changed file: hash it all.
  if [ "$(sha256_of "$bin")" = "$sha" ]; then
    chmod 700 "$bindir" "$bindir/$version" "$bin" 2>/dev/null
    stamp_verified
    exec "$bin" "$mode" "$@"
  fi
  # It no longer matches what the plugin carries: never run it; fetch it again.
  rm -f "$bin" "$verified"
fi

# ── the download itself: `sh plugin-run.sh __fetch`, detached, lock held ──
if [ "$mode" = "__fetch" ]; then
  [ -z "$why" ] || exit 0
  # Only this user may enter where the program is unpacked and kept.
  umask 077
  tmp="$bindir/.partial-$version-$$"
  fail() {
    printf '%s\n' "$1" >"$failed"
    rm -rf "$tmp"
    rmdir "$lock" 2>/dev/null
    exit 0
  }
  # A partial download whose process is gone died mid-transfer (its bytes
  # were never made executable): swept, whatever its version. One whose
  # process lives is left alone — a download that outlived its lock (a laptop
  # asleep mid-transfer) and the one that took the lock over each finish, or
  # fail, in their own directory, and the rename is atomic either way.
  for p in "$bindir"/.partial-*; do
    [ -d "$p" ] || continue
    kill -0 "${p##*-}" 2>/dev/null || rm -rf "$p"
  done
  mkdir -p "$tmp" "$bindir/$version" || fail "it could not write to the plugin's data directory"
  chmod 700 "$bindir" "$bindir/$version" || fail "it could not make the plugin's data directory private"
  proto="=https"
  case "$url" in http://127.0.0.1[:/]* | http://localhost[:/]*) proto="=http,https" ;; esac # a test's local server
  limit=""
  case "$gzbytes" in "" | *[!0-9]*) ;; *) limit="$((gzbytes + 1048576))" ;; esac
  # Done or given up within 25 minutes, retries included (--max-time bounds
  # each attempt; a retry starts only in the first five), so the half-hour
  # stale lock below is never taken from a download that is merely slow.
  curl -fsSL --proto "$proto" --proto-redir =https --max-redirs 5 ${limit:+--max-filesize "$limit"} \
    --retry 2 --retry-max-time 300 --connect-timeout 20 --max-time 1200 -o "$tmp/download.gz" "$url/$asset" 2>/dev/null ||
    fail "the download from GitHub failed"
  [ "$(sha256_of "$tmp/download.gz")" = "$gzsha" ] || fail "the download did not match the checksum the plugin carries"
  gunzip -c "$tmp/download.gz" >"$tmp/counterparts$exe" 2>/dev/null || fail "the download would not unpack"
  [ "$(sha256_of "$tmp/counterparts$exe")" = "$sha" ] || fail "the program did not match the checksum the plugin carries"
  chmod 700 "$tmp/counterparts$exe" || fail "it could not mark the program runnable"
  mv -f "$tmp/counterparts$exe" "$bin" || fail "it could not move the program into the plugin's data directory"
  stamp_verified
  rm -rf "$tmp"
  rm -f "$failed"
  # Another version's program not started for a week (its stamp is rewritten
  # at every server start) is one no installed plugin runs any more: ~100 MB.
  for old in "$bindir"/*/; do
    old="${old%/}"
    [ "$old" = "$bindir/$version" ] && continue
    [ -f "$old/verified" ] && [ -n "$(find "$old/verified" -mmin +10080 2>/dev/null)" ] && rm -rf "$old"
  done
  rmdir "$lock" 2>/dev/null
  exit 0
fi

# ── no binary yet: start the download (once), and say so ───────────────────
state="unavailable"
if [ -z "$why" ]; then
  for tool in curl gunzip; do
    command -v "$tool" >/dev/null 2>&1 || why="$tool is not on PATH"
  done
  if [ -z "$why" ] && ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1 &&
    ! command -v openssl >/dev/null 2>&1; then
    why="no sha256 tool (shasum, sha256sum or openssl) is on PATH"
  fi
fi
if [ -z "$why" ]; then
  (umask 077 && mkdir -p "$bindir") 2>/dev/null
  # A lock older than half an hour is a download that died holding it (curl
  # gives up within 25 minutes).
  [ -d "$lock" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin +30 2>/dev/null)" ] && rmdir "$lock" 2>/dev/null
  if [ -d "$lock" ]; then
    state="downloading"
  elif [ -f "$failed" ] && [ -z "$(find "$failed" -mmin +10 2>/dev/null)" ]; then
    state="failed"
  elif mkdir "$lock" 2>/dev/null; then
    state="downloading"
    # DETACHED, so neither the hook's exit nor the host ending its process
    # group takes the download with it: its own session where `setsid`
    # exists (Linux), its own process group through job control otherwise
    # (macOS's /bin/sh).
    if command -v setsid >/dev/null 2>&1; then
      setsid sh "$0" __fetch </dev/null >/dev/null 2>&1 &
    else
      (
        set -m 2>/dev/null
        sh "$0" __fetch </dev/null >/dev/null 2>&1 &
      )
    fi
  else
    state="downloading" # another process took the lock a moment ago
  fi
fi

mb=""
[ -n "$gzbytes" ] && mb="about $((gzbytes / 1048576)) MB, "
case "$state" in
  downloading)
    said="Counterparts is getting ready: this computer has no Bun or Node.js, so it is downloading its own program (${mb}from github.com/mlapeter/counterparts releases, checked against the checksum the plugin carries). Memory starts in your next session."
    told="Counterparts memory is not running yet in this session: it is downloading its program (${mb}from github.com/mlapeter/counterparts releases) and starts in the next session. If the person asks about memory, tell them that."
    ;;
  failed)
    reason=""
    IFS= read -r reason <"$failed" 2>/dev/null
    said="Counterparts could not get its program ready: ${reason:-the download failed}. Nothing unchecked was run. It will try again when a later session starts, or install Bun (https://bun.sh) or Node.js 22.15+ (https://nodejs.org) and restart Claude Code."
    told="Counterparts memory is not running in this session: downloading its program failed (${reason:-unknown reason}); it retries at a later session start. If the person asks about memory, tell them that."
    ;;
  *)
    said="Counterparts (memory) is not running: it needs Bun 1.3+ or Node.js 22.15+ and found neither on PATH or in the usual places${why:+ ($why)}. Install one (https://bun.sh or https://nodejs.org), then restart Claude Code."
    told="Counterparts memory is not running in this session (no Bun 1.3+ or Node.js 22.15+ found). If the person asks about memory, tell them that."
    ;;
esac

if [ "$mode" = "hook" ]; then
  payload=""
  while IFS= read -r line || [ -n "$line" ]; do
    payload="$payload$line"
  done
  case "$payload" in
    *'"hook_event_name":"SessionStart"'* | *'"hook_event_name": "SessionStart"'*)
      printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' \
        "$said" "$told"
      ;;
  esac
  exit 0
fi

if [ "$mode" = "mcp" ] && [ "$state" != "unavailable" ]; then
  # A SERVER WITH NO TOOLS that says why, so /mcp shows it connected and the
  # model can answer "is memory on?" — newline-delimited JSON-RPC, read with
  # parameter expansion. Requests get an answer; notifications get none.
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in *'"id"'*) ;; *) continue ;; esac
    # The request's own id, not one inside its params: next to "jsonrpc"
    # (the MCP SDK writes `…,"jsonrpc":"2.0","id":N}`, most clients
    # `{"jsonrpc":"2.0","id":N,…`), else first, else the last one.
    case "$line" in
      *'"jsonrpc":"2.0","id":'*) id="${line#*\"jsonrpc\":\"2.0\",\"id\":}" ;;
      '{"id":'*) id="${line#\{\"id\":}" ;;
      *)
        id="${line##*\"id\"}"
        id="${id#*:}"
        ;;
    esac
    id="${id# }"
    case "$id" in
      \"*)
        id="${id#\"}"
        id="\"${id%%\"*}\""
        ;;
      *) id="${id%%[,\} ]*}" ;;
    esac
    method="${line#*\"method\"}"
    method="${method#*\"}"
    method="${method%%\"*}"
    case "$method" in
      initialize)
        pv="2025-06-18"
        case "$line" in *'"protocolVersion"'*)
          pv="${line#*\"protocolVersion\"}"
          pv="${pv#*\"}"
          pv="${pv%%\"*}"
          ;;
        esac
        printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"%s","capabilities":{"tools":{}},"serverInfo":{"name":"counterparts","version":"%s"},"instructions":"%s"}}\n' \
          "$id" "$pv" "${version:-0}" "$told"
        ;;
      tools/list) printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[]}}\n' "$id" ;;
      ping) printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id" ;;
      *) printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"%s"}}\n' "$id" "$told" ;;
    esac
  done
  exit 0
fi

echo "$said" >&2
exit 127
