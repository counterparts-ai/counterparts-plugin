/**
 * Where this folder stands, read from the scope registry FILE, the one the
 * hooks and the memory server read (`<config dir>/scopes.json`), so the sidebar
 * never needs the `scope` tool to read. The tool goes through the permission
 * check, and in auto mode with no allow rule the sidebar never made that read:
 * a session started in a paused folder showed `?` until clicked (2026-10-09).
 * An allow rule for `scope` would let the model pause folders, so the file it
 * is. The tool stays for writes, after the confirm.
 *
 * A copy of the core's rules (a mod can't import from outside its folder):
 *
 * - **Which file** (`src/adapters/config-path.ts`, `scopes.ts#scopesPath`): the
 *   wired hook's own `--config <path>`, else `COUNTERPARTS_CONFIG`, else
 *   `~/.counterparts/claude-code.json`; the registry sits beside it.
 * - **What it says** (`scopes.ts#parseRegistry`): `version` 1, `scopes` keyed
 *   by absolute path. A file that is not a registry at all reads as no entries
 *   (every folder unset); a bad entry is skipped by itself.
 * - **Which entry governs** (`scopes.ts#lookupScope`): the longest ancestor,
 *   segment-aware (`/a/b` never governs `/a/bc`), both sides canonical; a tie
 *   between two keys for one folder goes to the more restrictive.
 *
 * Pure: the caller does the reading and the path resolving.
 */

export type RegistryMode = 'on' | 'observer' | 'off' | 'paused'

const MODES: readonly string[] = ['on', 'observer', 'off', 'paused']

/** `scopes.ts#rankOf`: paused and off are one rank. */
function rank(mode: RegistryMode): number {
  return mode === 'observer' ? 1 : mode === 'off' || mode === 'paused' ? 2 : 0
}

/** The entries a registry file holds, by key as written; a file that is not a registry holds none. */
export function parseRegistry(text: string): Record<string, RegistryMode> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  if (rec['version'] !== 1) return {}
  const scopes = rec['scopes']
  if (scopes === null || typeof scopes !== 'object' || Array.isArray(scopes)) return {}
  const out: Record<string, RegistryMode> = {}
  for (const [key, value] of Object.entries(scopes as Record<string, unknown>)) {
    if (!key.startsWith('/')) continue // a pseudo-scope (`claude-desktop:`) or not a path
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    const mode = entry['mode']
    const since = entry['since']
    const resumeTo = entry['resumeTo']
    const note = entry['note']
    if (typeof mode !== 'string' || !MODES.includes(mode)) continue
    if (typeof since !== 'string' || since.length === 0) continue
    if (resumeTo !== undefined && resumeTo !== 'on' && resumeTo !== 'observer') continue
    if (note !== undefined && typeof note !== 'string') continue
    out[key] = mode as RegistryMode
  }
  return out
}

/** Is `dir` at or under `key`? Segment-aware. */
export function under(key: string, dir: string): boolean {
  if (key === dir) return true
  return dir.startsWith(key.endsWith('/') ? key : `${key}/`)
}

/**
 * The entry that governs `target` (canonical), from entries whose keys
 * `canon` has made canonical: its mode and its key, or unset.
 */
export function lookup(
  entries: readonly { key: string; canonical: string; mode: RegistryMode }[],
  target: string,
): { mode: RegistryMode | 'unset'; matched: string | null; canonical: string | null } {
  let best: { key: string; canonical: string; mode: RegistryMode } | null = null
  for (const e of entries) {
    if (!under(e.canonical, target)) continue
    if (best === null || e.canonical.length > best.canonical.length) best = e
    else if (e.canonical === best.canonical && rank(e.mode) > rank(best.mode)) best = e
  }
  return best === null ? { mode: 'unset', matched: null, canonical: null } : { mode: best.mode, matched: best.key, canonical: best.canonical }
}

/** `runtime.ts#shellTokens`: whitespace, honouring double quotes (the only quoting `install` writes). */
export function shellTokens(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let any = false
  for (const ch of command) {
    if (ch === '"') {
      quoted = !quoted
      any = true
    } else if (!quoted && /\s/.test(ch)) {
      if (any) out.push(cur)
      cur = ''
      any = false
    } else {
      cur += ch
      any = true
    }
  }
  if (any) out.push(cur)
  return out
}

const HOOK_ENTRY = /(^|[/\\])adapters[/\\]claude-code[/\\]bin[/\\]hook\.(ts|mjs)$/
const SHELL_OPERATOR = /&&|\|\||;|\||>|<|`|\$\(/

/** `host-wiring.ts#isBinaryName`: the single binary, not the old per-mode shims. */
function isBinaryName(exe: string): boolean {
  const name = exe.split(/[\\/]/).pop() ?? ''
  return /^counterparts([-.][\w.-]*)?$/i.test(name) && !/^counterparts-(hook|mcp|dashboard)(\.exe)?$/i.test(name)
}

/**
 * What a settings hook command says about the configuration, read the way
 * `host-wiring.ts#readOurHook` reads what it runs: undefined when it does not
 * run our hook; else the `--config` after the hook (a Bun `--config=` BEFORE
 * the script is Bun's own), or null when it names none.
 */
export function hookConfig(command: string): string | null | undefined {
  if (SHELL_OPERATOR.test(command)) return undefined
  const tokens = shellTokens(command)
  const exe = tokens[0] ?? ''
  if (exe.length === 0) return undefined
  const isFlag = (t: string | undefined): boolean => t !== undefined && t.length > 1 && t.startsWith('-')
  let at = 1
  if (/(^|[/\\])counterparts-hook$/.test(exe)) {
    // the old per-mode shim: what follows it is the hook's own
  } else if (isBinaryName(exe)) {
    while (isFlag(tokens[at])) at += 1
    if (tokens[at] !== 'hook') return undefined
    at += 1
  } else {
    let ran = false
    let entry = false
    for (; at < tokens.length; at += 1) {
      const t = tokens[at] ?? ''
      if (isFlag(t)) {
        if (t === '--import') at += 1
        continue
      }
      if (t === 'run' && !ran) {
        ran = true
        continue
      }
      if (!HOOK_ENTRY.test(t)) return undefined
      entry = true
      at += 1
      break
    }
    if (!entry) return undefined
  }
  const rest = tokens.slice(at)
  for (let i = 0; i < rest.length; i += 1) {
    const t = rest[i] ?? ''
    if (t === '--config') return rest[i + 1] ?? ''
    if (t.startsWith('--config=')) return t.slice('--config='.length)
  }
  return null
}

/**
 * The configuration the first of our hooks in a settings file names: a path,
 * null for ours with none, undefined for no hook of ours in it.
 */
export function settingsHookConfig(text: string): string | null | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const hooks = (raw as { hooks?: unknown } | null)?.hooks
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) return undefined
  let found: string | null | undefined
  for (const groups of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      const entries = (group as { hooks?: unknown } | null)?.hooks
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        const command = (entry as { command?: unknown } | null)?.command
        if (typeof command !== 'string') continue
        const c = hookConfig(command)
        if (typeof c === 'string') return c
        if (c === null) found = null
      }
    }
  }
  return found
}

/** The folder a path sits in, by either separator. */
export function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut <= 0 ? path.slice(0, cut + 1) || '/' : path.slice(0, cut)
}
