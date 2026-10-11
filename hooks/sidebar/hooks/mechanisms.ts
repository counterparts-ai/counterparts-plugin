/**
 * The twelve mechanisms by the website's names, in the website's four stage
 * colours, and the brain region each one lights.
 *
 * Lineage: the stage colours are the site's (`counterparts-site` regions.ts
 * FAMILIES); the short names, taglines and regions are the approved mockup's
 * (`~/counterparts-notes/mockups/2026-10-09-mod/index.html`, `MECHS`, which
 * took them from the site). The order and the ids are the dashboard's
 * (`src/adapters/mechanism-evidence.ts`), so a row of the dashboard's feed
 * and a dot here mean the same mechanism. Pure data: no `$`, no engine.
 */

import type { SidebarMechId } from '../types';

export type Rgb = readonly [number, number, number];

export type StageId = 'encoding' | 'storage' | 'retrieval' | 'transformation';

export type MechId = SidebarMechId;

export type RegionKey = 'prefrontal' | 'amygdala' | 'hippocampus' | 'thalamus' | 'brainstem' | 'cortex' | 'cerebellum';

export type Stage = { readonly id: StageId; readonly label: string; readonly col: Rgb };

/** The website's four stages; colours as 0..1 floats, the brain engine's unit. */
export const STAGES: Readonly<Record<StageId, Stage>> = {
  encoding: { id: 'encoding', label: 'Encoding', col: [0.0, 0.898, 1.0] },
  storage: { id: 'storage', label: 'Storage', col: [0.5, 0.66, 1.0] },
  retrieval: { id: 'retrieval', label: 'Retrieval', col: [1.0, 0.79, 0.3] },
  transformation: { id: 'transformation', label: 'Transformation', col: [0.7, 0.53, 1.0] },
};

export type Mech = {
  readonly id: MechId;
  readonly stage: StageId;
  /** The website's short name, the legend's word. */
  readonly short: string;
  readonly region: RegionKey;
  /** The website's one line: what slides open under the legend. */
  readonly site: string;
  /** Drawn hollow: not built. */
  readonly notBuilt?: true;
};

export const MECHS: readonly Mech[] = [
  { id: 'salience', stage: 'encoding', short: 'Salience', region: 'amygdala',
    site: 'Not everything that happens is worth keeping. Something has to decide.' },
  { id: 'emotional', stage: 'encoding', short: 'Emotion', region: 'amygdala',
    site: "The moments that mattered are the ones you keep. Feeling is the encoder's thumb on the scale." },
  { id: 'decay', stage: 'storage', short: 'Forgetting', region: 'brainstem',
    site: "Forgetting isn't a failure of memory. It's one of its jobs." },
  { id: 'interference', stage: 'storage', short: 'Interference', region: 'hippocampus',
    site: 'New memories crowd out old ones. Old ones distort new ones. They compete.' },
  { id: 'retrieval', stage: 'retrieval', short: 'Retrieval', region: 'thalamus',
    site: 'Every time you remember something, you make it a little stronger.' },
  { id: 'association', stage: 'retrieval', short: 'Association', region: 'hippocampus',
    site: 'Recalling one thing pulls its neighbours along with it.' },
  { id: 'prospective', stage: 'retrieval', short: 'Prospective', region: 'prefrontal',
    site: 'Remembering to do something later: the memory that fires itself at the right moment.' },
  { id: 'consolidation', stage: 'transformation', short: 'Consolidation', region: 'hippocampus',
    site: "Memories aren't saved when they're made. They're rebuilt, offline, while you sleep." },
  { id: 'dreaming', stage: 'transformation', short: 'Dreaming', region: 'hippocampus',
    site: 'Overnight, the day is replayed: near-copies merge and what belongs together gets linked.' },
  { id: 'reconsolidation', stage: 'transformation', short: 'Reconsolidation', region: 'prefrontal',
    site: "Recall makes a memory briefly editable. Then it's re-stored, sometimes rewritten." },
  { id: 'episodic-semantic', stage: 'transformation', short: 'Gist', region: 'cortex',
    site: '“I met her on Tuesday” slowly becomes “I know her”: the event fades, the meaning stays.' },
  { id: 'schema', stage: 'transformation', short: 'Schemas', region: 'prefrontal', notBuilt: true,
    site: "New facts don't land on blank ground. They're folded into what you already believe. Not built yet." },
];

const BY_ID = new Map<string, Mech>(MECHS.map(m => [m.id, m]));

export function mechById(id: string): Mech | undefined {
  return BY_ID.get(id);
}

export function stageOf(id: MechId): Stage {
  const m = BY_ID.get(id);
  return STAGES[m === undefined ? 'encoding' : m.stage];
}

/** A 0..1 colour as `#rrggbb`, scaled by `k` and clipped. */
export function hex(col: Rgb, k = 1): string {
  const c = (v: number): string => Math.max(0, Math.min(255, Math.round(v * 255 * k))).toString(16).padStart(2, '0');
  return `#${c(col[0])}${c(col[1])}${c(col[2])}`;
}

/**
 * The dashboard's port, read the way core's server reads it
 * (`dashboard/web/server.ts#resolvePort`): `COUNTERPARTS_DASHBOARD_PORT` when
 * it is a whole number, else 4747. A `--port` given at launch can't be found
 * from here (core writes no port file, and `/api/pulse` doesn't say): a core
 * ask (NOTES). `0` asks the OS for any free port, which leaves nothing to
 * find, so it reads as the default; so does anything past 65535.
 */
export const DASHBOARD_PORT = 4747;
export function dashboardPort(raw: string | null | undefined): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DASHBOARD_PORT;
}

/** The dashboard's address on a port. */
export function dashboardBase(port: number = DASHBOARD_PORT): string {
  return `http://localhost:${String(port)}`;
}
/** The address on the default port. */
export const DASHBOARD = dashboardBase();

/**
 * The only links the sidebar opens: the dashboard's, on localhost and the
 * port it read, in a strict character set.
 */
export function isDashboardUrl(url: string, port: number): boolean {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return false;
  return new RegExp(`^http://localhost:${String(port)}/[A-Za-z0-9#?=/_.~-]*$`).test(url);
}

/** The page each mechanism opens on. */
export function mechUrl(id: MechId, base: string = DASHBOARD): string {
  return `${base}/#health/mechanisms?id=${id}`;
}
export const MEMORIES_URL = `${DASHBOARD}/#memories`;
/**
 * One memory's card on the dashboard (`#memories?id=`, 2026-10-10). A
 * dashboard older than that opens its Memories page instead.
 */
export function memoryUrl(id: string, base: string = DASHBOARD): string {
  return `${base}/#memories?id=${encodeURIComponent(id)}`;
}

/**
 * How this install starts the dashboard, said where the dashboard is down.
 * The memory server this session connected tells the installs apart: the npm
 * install registers `counterparts` (and puts `counterparts` on the PATH); a
 * plugin-only install connects the plugin's own server and has no such
 * command, so it gets `/counterparts:dashboard`. Beside the npm install the
 * plugin's server stands down with no tools, so the npm one is what resolves.
 * Not known yet (no server found): the plugin route first, since it works
 * under either install.
 */
export const NPM_DASHBOARD_ROUTE = 'counterparts dashboard';
export const PLUGIN_DASHBOARD_ROUTE = '/counterparts:dashboard';
export function dashboardRoutes(server: string | null): readonly string[] {
  if (server === 'counterparts') return [NPM_DASHBOARD_ROUTE];
  if (server === 'plugin_counterparts_counterparts') return [PLUGIN_DASHBOARD_ROUTE];
  return [PLUGIN_DASHBOARD_ROUTE, NPM_DASHBOARD_ROUTE];
}
