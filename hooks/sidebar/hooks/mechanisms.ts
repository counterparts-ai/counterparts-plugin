/**
 * The twelve mechanisms by the website's names, in the website's four stage
 * colours.
 *
 * Lineage: the stage colours are the site's (`counterparts-site` regions.ts
 * FAMILIES); the short names and taglines are the approved mockup's
 * (`~/counterparts-notes/mockups/2026-10-09-mod/index.html`, `MECHS`, which
 * took them from the site). The order and the ids are the dashboard's
 * (`src/adapters/mechanism-evidence.ts`), so a row of the dashboard's feed
 * and a dot here mean the same mechanism. Pure data: no `$`, no engine.
 */

import type { SidebarMechId } from '../types';

export type Rgb = readonly [number, number, number];

export type StageId = 'encoding' | 'storage' | 'retrieval' | 'transformation';

export type MechId = SidebarMechId;

export type Stage = { readonly id: StageId; readonly label: string; readonly col: Rgb };

/** The website's four stages; colours as 0..1 floats. */
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
  /** The website's one line: what slides open under the legend. */
  readonly site: string;
  /** Drawn hollow: not built. */
  readonly notBuilt?: true;
};

export const MECHS: readonly Mech[] = [
  { id: 'salience', stage: 'encoding', short: 'Salience',
    site: 'Not everything that happens is worth keeping. Something has to decide.' },
  { id: 'emotional', stage: 'encoding', short: 'Emotion',
    site: "The moments that mattered are the ones you keep. Feeling is the encoder's thumb on the scale." },
  { id: 'decay', stage: 'storage', short: 'Forgetting',
    site: "Forgetting isn't a failure of memory. It's one of its jobs." },
  { id: 'interference', stage: 'storage', short: 'Interference',
    site: 'New memories crowd out old ones. Old ones distort new ones. They compete.' },
  { id: 'retrieval', stage: 'retrieval', short: 'Retrieval',
    site: 'Every time you remember something, you make it a little stronger.' },
  { id: 'association', stage: 'retrieval', short: 'Association',
    site: 'Recalling one thing pulls its neighbours along with it.' },
  { id: 'prospective', stage: 'retrieval', short: 'Prospective',
    site: 'Remembering to do something later: the memory that fires itself at the right moment.' },
  { id: 'consolidation', stage: 'transformation', short: 'Consolidation',
    site: "Memories aren't saved when they're made. They're rebuilt, offline, while you sleep." },
  { id: 'dreaming', stage: 'transformation', short: 'Dreaming',
    site: 'Overnight, the day is replayed: near-copies merge and what belongs together gets linked.' },
  { id: 'reconsolidation', stage: 'transformation', short: 'Reconsolidation',
    site: "Recall makes a memory briefly editable. Then it's re-stored, sometimes rewritten." },
  { id: 'episodic-semantic', stage: 'transformation', short: 'Gist',
    site: '“I met her on Tuesday” slowly becomes “I know her”: the event fades, the meaning stays.' },
  { id: 'schema', stage: 'transformation', short: 'Schemas', notBuilt: true,
    site: "New facts don't land on blank ground. They're folded into what you already believe." },
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
 * How to open the dashboard, said where it is down: the plugin's own command.
 * Every install that draws this sidebar has it (the sidebar ships in the
 * plugin), beside the npm install too. Until 2026-10-12 an npm install was
 * told the console's `counterparts dashboard` instead; a stranger's read
 * found two ways to say one thing, and the slash command works everywhere.
 */
export const PLUGIN_DASHBOARD_ROUTE = '/counterparts:dashboard';
