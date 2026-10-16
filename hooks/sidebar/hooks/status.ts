/**
 * The status file Counterparts writes for the sidebar (shared core, no `$`):
 * `sidebar.json` beside the configuration, next to `scopes.json`, written by
 * core's own processes (`src/adapters/sidebar-status.ts`: the detached worker
 * after every turn's end, the memory server after its tool calls and whenever
 * the log moves). The sidebar reads it with `$.fs.read` on its timer and asks
 * no network for anything (the plugin directory's review, 2026-10-14).
 *
 * What it holds is what the dashboard's answers held, computed by the
 * same view functions: which store it is, the pulse, today's counts, the newest
 * dreams, the newest rows of the activity log, each mechanism's panel, and the
 * memories those rows name (title, kind, learned date, the start of the text).
 */

import type { DashDream, DashEvent } from './feed'

/** Its name, beside `scopes.json`. */
export const STATUS_FILE = 'sidebar.json'

/** The one shape this sidebar reads; a file of another version shows nothing. */
export const STATUS_VERSION = 1

/** A file older than this says how old it is (`3 h ago` where the chart says `times fired`): the writers refresh it every half hour while a session runs. */
export const STATUS_STALE_MS = 60 * 60000

export type StatusMemory = {
  title: string
  text: string
  /** The text was cut: the rest is on the dashboard (`more`). */
  cut: boolean
  kind: string | null
  learnedOn: string | null
  journal: boolean
}

export type Status = {
  version: number
  storeId: string | null
  writtenAt: number
  build: string | null
  /**
   * Where the dashboard serves when it runs, as core wrote it (2026-10-16): data, never spelled or built
   * here. Only the full plugin draws it, as a link (`actions.tsx`, which checks it is this machine's). Null:
   * a file from before, or no address known.
   */
  dashboard: string | null
  pulse: { day: number; memories: number; lastSeq: number }
  today: { date: string; counts: Record<string, number> } | null
  dreams: DashDream[]
  /** Newest first. */
  events: DashEvent[]
  panels: Record<string, DashEvent[]>
  memories: Record<string, StatusMemory | null>
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The file's text read whole, or null: not JSON, another version, or a part missing. */
export function parseStatus(text: string): Status | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(v) || v.version !== STATUS_VERSION || !num(v.writtenAt)) return null
  const p = v.pulse
  if (!isObj(p) || !num(p.day) || !num(p.memories) || !num(p.lastSeq)) return null
  const events = Array.isArray(v.events) ? (v.events.filter(e => isObj(e) && num(e.seq) && num(e.at) && typeof e.name === 'string') as DashEvent[]) : []
  const panels: Record<string, DashEvent[]> = {}
  if (isObj(v.panels)) {
    for (const [k, rows] of Object.entries(v.panels)) if (Array.isArray(rows)) panels[k] = rows.filter(e => isObj(e) && num(e.seq)) as DashEvent[]
  }
  let today: Status['today'] = null
  if (isObj(v.today) && typeof v.today.date === 'string' && isObj(v.today.counts)) {
    const counts: Record<string, number> = {}
    for (const [k, n] of Object.entries(v.today.counts)) if (num(n)) counts[k] = n
    today = { date: v.today.date, counts }
  }
  const memories: Record<string, StatusMemory | null> = {}
  if (isObj(v.memories)) {
    for (const [id, m] of Object.entries(v.memories)) {
      memories[id] =
        isObj(m) && typeof m.title === 'string'
          ? {
              title: m.title,
              text: typeof m.text === 'string' ? m.text : '',
              cut: m.cut === true,
              kind: typeof m.kind === 'string' ? m.kind : null,
              learnedOn: typeof m.learnedOn === 'string' ? m.learnedOn : null,
              journal: m.journal === true,
            }
          : null
    }
  }
  return {
    version: STATUS_VERSION,
    storeId: typeof v.storeId === 'string' && /^st_[0-9a-f]{16}$/.test(v.storeId) ? v.storeId : null,
    writtenAt: v.writtenAt,
    build: typeof v.build === 'string' ? v.build : null,
    dashboard: typeof v.dashboard === 'string' && v.dashboard.length <= 64 ? v.dashboard : null,
    pulse: { day: p.day, memories: p.memories, lastSeq: p.lastSeq },
    today,
    dreams: Array.isArray(v.dreams) ? (v.dreams.filter(d => isObj(d) && typeof d.id === 'string') as DashDream[]) : [],
    events: [...events].sort((a, b) => b.seq - a.seq),
    panels,
    memories,
  }
}

/**
 * How much newer a file must be to stand over a higher seq of its own store.
 * Two writers racing land an older file a few milliseconds late, its
 * `writtenAt` older too; a store put back (a rollback, a snapshot restored:
 * same id, a lower seq) is written later than that, so its file is taken.
 */
export const PUT_BACK_MS = 5000

/**
 * Does the file read before stand over the one just read? Only for the same
 * store, at a higher seq, when the new one is not newer by {@link PUT_BACK_MS}.
 */
export function keepsBefore(before: Status | null, next: Status): boolean {
  if (before === null || next.storeId === null || next.storeId !== before.storeId) return false
  if (next.pulse.lastSeq >= before.pulse.lastSeq) return false
  return next.writtenAt - before.writtenAt < PUT_BACK_MS
}

/** The rows named `name`, newest first, at most `limit`. */
export function rowsNamed(s: Status, name: string, limit = Infinity): DashEvent[] {
  const out: DashEvent[] = []
  for (const e of s.events) {
    if (out.length >= limit) break
    if (e.name === name) out.push(e)
  }
  return out
}

/** The rows after `seq`, oldest first. */
export function rowsSince(s: Status, seq: number): DashEvent[] {
  return s.events.filter(e => e.seq > seq).sort((a, b) => a.seq - b.seq)
}

/** A memory the file names: its title and text, or null (gone, or not among the ones it carries). */
export function memoryIn(s: Status | null, id: string): StatusMemory | null {
  return s?.memories[id] ?? null
}

/** What a memory the file does not carry shows when opened: its title and where its card is. */
export const NOT_CARRIED = 'Its full card is on the dashboard: /counterparts:dashboard'

/** `just now`, `12 min ago`, `3 h ago`, `2 days ago`. */
export function agoWords(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${String(min)} min ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${String(h)} h ago`
  return `${String(Math.floor(h / 24))} days ago`
}
