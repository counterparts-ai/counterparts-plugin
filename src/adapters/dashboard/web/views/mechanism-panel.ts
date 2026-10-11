/**
 * `/api/mechanism?id=<id>` — what the home page's mechanism panel shows for the
 * picked mechanism: its last few firings, narrated, and a small picture of THIS
 * store's real data where the site shows a demo.
 *
 * Since home round 3b (2026-09-27, a try) EVERY built mechanism has a picture,
 * and each is about our own memories, at most `PICTURE_ROWS` of them:
 *
 *   salience          — recent memories and the score each was written with
 *   emotional         — the newest memories a feeling holds higher, with it
 *   decay             — the fade curves of a few real memories, from their last use
 *   retrieval         — the last turns that brought memories to mind, and whether
 *                       each one has been used since
 *   association       — the graph hubs: what the most is wired to
 *   prospective       — reminders that came back, and dated memories waiting
 *   consolidation     — what came back in conversation, merged, or was replayed
 *                       in a dream this week (who is close to the core is Self's)
 *   dreaming          — the memories the last dream changed
 *   reconsolidation   — recent corrections weighed against old memories
 *   episodic-semantic — the patterns dreams wrote as memories of their own
 *
 * A grey mechanism (not built) gets no picture and no activity: it has none.
 * Which rows count as a firing is `MECHANISM_PROOFS`, in `mechanisms.ts`.
 *
 * Read-only, like everything in this directory. Memory words go through
 * `reveal`, so a confidential row is withheld here exactly as everywhere else.
 */
import { TUNABLES, pruneVerdict, strength } from "../../../../core/physics/index.js";
import type { MemoryPhysics } from "../../../../core/types.js";
import { isJournal } from "../../../../core/sleep/index.js";
import type { DreamRow, EventRow } from "../../../../core/store/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import type { DashboardSource } from "../../source.js";
import { narrateForPanel } from "../narrate.js";
import type { NarratedEvent } from "../narrate.js";
import { reveal, revealHere } from "../reveal.js";
import { feelingsShown } from "./memory-words.js";
import type { FeelingShown } from "./memory-words.js";
import { MECHANISM_DAYS, MECHANISM_PROOFS, counted, payloadOf } from "./mechanisms.js";
import { LOG_CEILING, census } from "./shared.js";
import type { MemoryLine } from "./shared.js";

/** How many narrated firings the panel lists. */
export const PANEL_ACTIVITY = 4;
/** How many memories a picture lists (the fade curves draw four). */
export const PICTURE_ROWS = 5;
/** How far back, per event name, the panel looks for them. */
const ACTIVITY_LOOKBACK = 200;
/** How many lived days ahead a fade curve is drawn. */
export const FADE_AHEAD = 60;
/** How many lived days behind "now" a fade curve may start. */
export const FADE_BEHIND = 60;

interface Said {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
}

function said(src: DashboardSource, id: string, width = 72): Said {
  const r = reveal(src.store, id, width);
  return { id, text: r.text ?? r.label, confidential: r.confidential };
}

function saidLine(m: MemoryLine): Said {
  return { id: m.id, text: m.text, confidential: m.confidential };
}

export interface FadeCurve extends Said {
  readonly kind: Kind;
  readonly band: Band;
  readonly lastUsedDay: number;
  readonly now: number;
  /** [lived day, strength] pairs, one per day, from the curve's start. */
  readonly points: readonly (readonly [number, number])[];
  /** The first lived day ahead on which it falls below the archive line, if unused. */
  readonly archiveDay: number | null;
}

export type Picture =
  | {
      readonly kind: "decay";
      readonly day: number;
      readonly from: number;
      readonly to: number;
      /** Below this a memory drops out of the semantic band. */
      readonly semanticFloor: number;
      /** Below this a memory can be archived. */
      readonly archiveLine: number;
      readonly curves: readonly FadeCurve[];
    }
  | {
      readonly kind: "retrieval";
      readonly turns: readonly {
        readonly seq: number;
        readonly day: number;
        readonly turn: number;
        readonly memories: readonly (Said & { readonly said: boolean; readonly usedSince: boolean })[];
      }[];
      /** Of the memories brought to mind lately, how many got used (`recallUse`). */
      readonly use: RecallUse;
    }
  | {
      readonly kind: "consolidation";
      /**
       * Returns in the last `MECHANISM_DAYS` lived days, by source: `awake`
       * came back in conversation (the only kind the core lanes count),
       * `dream` was replayed in a dream. The upgrade's `legacy` rows are not
       * returns anyone saw and are not counted.
       */
      readonly returns: { readonly awake: number; readonly dream: number; readonly days: number };
      /** Merges in the window: exact duplicates at sleep, near-copies in a dream that stands. */
      readonly merges: number;
      /**
       * Up to `PICTURE_ROWS` of the memories behind those numbers: came back in
       * conversation first, then merged, then replayed in a dream. `times` is
       * how many of the window's returns (or merges) it holds; `day` the newest.
       * Who is close to the core is the Self tab's, not this picture's (3b).
       */
      readonly memories: readonly (Said & { readonly how: "awake" | "merged" | "dream"; readonly day: number; readonly times: number })[];
    }
  | {
      readonly kind: "emotional";
      /**
       * The newest live memories a feeling holds higher (its emotional score,
       * or a recorded feeling with strength): up to `PICTURE_ROWS`, each with
       * its feelings, strongest first. WHICH memories a matching mood brought
       * closer is not recorded per memory (`recall.decision` keeps the count
       * only), so they are not guessed here.
       */
      readonly memories: readonly (Said & { readonly bornDay: number; readonly emotional: number; readonly feelings: readonly FeelingShown[] })[];
    }
  | {
      readonly kind: "prospective";
      /** Reminders that came back in the window, newest first: said plainly, or a quiet footnote. */
      readonly came: readonly (Said & { readonly day: number; readonly plain: boolean })[];
      /** Dated memories whose day is today or ahead, soonest first (fills the rest of the rows). */
      readonly waiting: readonly (Said & { readonly date: string })[];
      /** How many came back in the window, and how many are waiting — the lists above are the first of these. */
      readonly counts: { readonly came: number; readonly waiting: number };
    }
  | {
      readonly kind: "dreaming";
      /** The newest dream that stands (not undone), or null when there is none. */
      readonly dream: { readonly id: string; readonly date: string | null; readonly day: number; readonly title: string | null; readonly changes: number } | null;
      /** The memories it changed, one row each, in the order it changed them. */
      readonly memories: readonly (Said & { readonly did: string })[];
    }
  | {
      readonly kind: "episodic-semantic";
      /** Patterns a standing dream wrote as memories of their own, newest first. */
      readonly gists: readonly (Said & { readonly day: number; readonly date: string | null })[];
    }
  | {
      readonly kind: "salience";
      /** The most salient of the memories written in the window, highest first. */
      readonly memories: readonly (Said & { readonly salience: number; readonly bornDay: number; readonly memKind: Kind })[];
      /** How many memories were written in the window — `memories` is the top of these. */
      readonly written: number;
      readonly days: number;
    }
  | {
      readonly kind: "association";
      readonly hubs: readonly (Said & { readonly weight: number; readonly degree: number })[];
      readonly links: number;
    }
  | {
      readonly kind: "interference";
      /** The newest pairs of memories that disagree (2026-09-29), older first in each. */
      readonly pairs: readonly {
        readonly id: string;
        readonly day: number;
        /** `unsettled` or `settled`. */
        readonly state: string;
        /** `changed`, `corrected` or `open` once settled. */
        readonly how: string | null;
        readonly older: Said;
        readonly newer: Said;
      }[];
    }
  | {
      readonly kind: "reconsolidation";
      readonly revisions: readonly {
        readonly seq: number;
        readonly day: number;
        readonly target: Said;
        readonly challenger: Said;
        readonly pressure: number;
        readonly bar: number;
        readonly crossed: boolean;
      }[];
    };

export interface MechanismPanelView {
  readonly id: string;
  readonly found: boolean;
  readonly built: boolean;
  readonly livedDay: number;
  /** The newest few rows that count as this mechanism firing, narrated; a run
   *  of lines that read the same is one line with `repeats` (its newest row)
   *  and `fromDay` (its oldest row's day). */
  readonly activity: readonly Merged[];
  /** Null for a grey mechanism, and for a built one with no picture of its own. */
  readonly picture: Picture | null;
}

/** A narrated line standing for `repeats` neighbours that read the same. */
export type Merged = NarratedEvent & {
  repeats: number;
  /** The lived day of the OLDEST row it stands for; `day` is the newest's. */
  fromDay: number;
};

/**
 * "I wrote something down and every gate was clear" four times is one line,
 * ×4 (2026-09-26, an experiment). Only NEIGHBOURS that read the same merge, so
 * the order of what happened is kept; the merged line keeps its newest row, so
 * a click opens the latest record behind it. Lines arrive newest first, and
 * the run's span is kept (`fromDay`–`day`), so "×200" never hides that the 200
 * were spread over several days (2026-09-27).
 */
export function mergeRepeats(lines: readonly NarratedEvent[]): Merged[] {
  const out: Merged[] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (last !== undefined && last.text === line.text && last.name === line.name) {
      last.repeats += 1;
      last.fromDay = Math.min(last.fromDay, line.day);
    } else out.push({ ...line, repeats: 1, fromDay: line.day });
  }
  return out;
}

export function mechanismPanel(src: DashboardSource, id: string): MechanismPanelView {
  const store = src.store;
  const livedDay = store.livedDay();
  const proof = MECHANISM_PROOFS.find((m) => m.id === id);
  if (proof === undefined) return { id, found: false, built: false, livedDay, activity: [], picture: null };
  if (proof.build === "not") return { id, found: true, built: false, livedDay, activity: [], picture: null };

  const backing: EventRow[] = [];
  for (const p of proof.proofs) {
    for (const row of store.eventLog({ name: p.event, order: "desc", limit: ACTIVITY_LOOKBACK })) {
      if (counted(p, row, store) > 0) backing.push(row);
    }
  }
  const seen = new Set<number>();
  const ordered = backing
    .sort((a, b) => b.seq - a.seq)
    .filter((r) => (seen.has(r.seq) ? false : (seen.add(r.seq), true)));
  // Narrate newest first and stop once one line more than the panel shows has
  // begun: every shown line's count is then whole (within the lookback).
  const lines: NarratedEvent[] = [];
  let groups = 0;
  let lastText: string | null = null;
  for (const row of ordered) {
    const line = narrateForPanel(id, store, row);
    if (line.text !== lastText) {
      groups += 1;
      lastText = line.text;
      if (groups > PANEL_ACTIVITY) break;
    }
    lines.push(line);
  }
  const activity = mergeRepeats(lines).slice(0, PANEL_ACTIVITY);

  return { id, found: true, built: true, livedDay, activity, picture: pictureOf(src, id, livedDay) };
}

function pictureOf(src: DashboardSource, id: string, day: number): Picture | null {
  switch (id) {
    case "decay":
      return decayPicture(src, day);
    case "retrieval":
      return retrievalPicture(src, day);
    case "consolidation":
      return consolidationPicture(src, day);
    case "salience":
      return saliencePicture(src, day);
    case "emotional":
      return emotionalPicture(src);
    case "association":
      return associationPicture(src);
    case "prospective":
      return prospectivePicture(src, day);
    case "dreaming":
      return dreamingPicture(src);
    case "episodic-semantic":
      return gistPicture(src);
    case "reconsolidation":
      return reconsolidationPicture(src);
    case "interference":
      return interferencePicture(src);
    default:
      return null;
  }
}

/** The first lived day of the panel's window (the lights' window). */
const windowStart = (day: number): number => Math.max(0, day - (MECHANISM_DAYS - 1));

/** Dreams that stand (not undone), newest first. */
function standingDreams(src: DashboardSource): DreamRow[] {
  return src.store.dreams({ limit: 20 }).filter((d) => d.state !== "undone");
}

// ── forgetting ──────────────────────────────────────────────────────────────

/**
 * Up to four real memories, spread across how strong they are today — the
 * strongest one that can still fade, the faintest, and two between — each drawn
 * from its last use to sixty lived days ahead, as the physics computes it. The
 * core identity band does not fade, so it is left out rather than drawn flat.
 */
function decayPicture(src: DashboardSource, day: number): Picture {
  const store = src.store;
  const fading = census(src).filter((m) => !m.schema && !m.promoted && !m.unreadable);
  const picks: MemoryLine[] = [];
  if (fading.length <= 4) picks.push(...fading);
  else {
    for (const q of [0, 0.35, 0.7, 1]) {
      const m = fading[Math.round(q * (fading.length - 1))];
      if (m !== undefined && !picks.includes(m)) picks.push(m);
    }
  }
  const to = day + FADE_AHEAD;
  let from = day;
  const curves: FadeCurve[] = picks.map((m) => {
    const physics = store.physicsOf(m.id);
    const curve = fadeCurve(physics, day);
    from = Math.min(from, curve.from);
    return { ...saidLine(m), kind: m.kind, band: m.band, lastUsedDay: physics.lastUsedDay, now: round(m.strength), points: curve.points, archiveDay: curve.archiveDay };
  });
  return {
    kind: "decay",
    day,
    from,
    to,
    semanticFloor: TUNABLES.THETA_SEM,
    archiveLine: TUNABLES.PHI_PRUNE,
    curves,
  };
}

// ── retrieval ───────────────────────────────────────────────────────────────

function idsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") out.push(item);
    else if (item !== null && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      out.push((item as { id: string }).id);
    }
  }
  return out;
}

/**
 * The last few turns that brought anything to mind: what was said out loud and
 * what was kept as a footnote, and whether each memory has been USED since —
 * read off the memory's own physics (its last credited use is on or after that
 * turn's day, and after its birth), not guessed from the turn.
 */
function retrievalPicture(src: DashboardSource, day: number): Picture {
  const store = src.store;
  const turns: Extract<Picture, { kind: "retrieval" }>["turns"][number][] = [];
  for (const row of store.eventLog({ name: "recall.decision", order: "desc", limit: ACTIVITY_LOOKBACK })) {
    const p = payloadOf(row);
    const surfaced = idsOf(p["surfaced"]);
    const footnotes = idsOf(p["footnotes"]);
    if (surfaced.length + footnotes.length === 0) continue;
    const memories = [
      ...surfaced.map((id) => ({ id, said: true })),
      ...footnotes.map((id) => ({ id, said: false })),
    ].slice(0, 6).map(({ id, said: aloud }) => ({ ...said(src, id, 64), said: aloud, usedSince: usedSince(src, id, row.day) }));
    const turn = typeof p["turn"] === "number" ? p["turn"] : 0;
    turns.push({ seq: row.seq, day: row.day, turn, memories });
    if (turns.length >= 3) break;
  }
  return { kind: "retrieval", turns, use: recallUse(src, day) };
}

/**
 * THE "USED SINCE" TEST, one copy: a memory brought to mind on `day` counts as
 * used when its last credited use is on or after that day, and after its
 * birth — read off the memory's own physics, not guessed from the turn.
 */
function usedSince(src: DashboardSource, id: string, day: number): boolean {
  try {
    const physics = src.store.physicsOf(id);
    return physics.lastUsedDay >= day && physics.lastUsedDay > physics.birthDay;
  } catch {
    return false;
  }
}

export interface UseCount {
  /** Memories brought to mind. */
  readonly brought: number;
  /** Of them, used since (`usedSince`). */
  readonly used: number;
}

export interface RecallUse extends UseCount {
  /** Lived days looked at, today included. */
  readonly days: number;
  readonly said: UseCount;
  readonly footnote: UseCount;
  /** One entry per lived day of the window, oldest first. */
  readonly perDay: readonly (UseCount & { readonly day: number })[];
}

/**
 * OF THE MEMORIES BROUGHT TO MIND LATELY, HOW MANY GOT USED (2026-09-27, home
 * round 3 — a try): every `recall.decision` of the last `MECHANISM_DAYS` lived
 * days, surfaced (said out loud) and footnotes apart. A memory counts ONCE PER
 * DAY — brought to mind on five turns of one day is one memory that day, said
 * out loud if any of those turns said it — and "used" is `usedSince` above,
 * the same test the turns' rows show.
 */
export function recallUse(src: DashboardSource, day: number, span = MECHANISM_DAYS): RecallUse {
  const from = Math.max(0, day - (span - 1));
  const byDay = new Map<number, Map<string, boolean>>();
  for (const row of src.store.eventLog({ name: "recall.decision", sinceDay: from, order: "desc", limit: LOG_CEILING })) {
    const p = payloadOf(row);
    let seen = byDay.get(row.day);
    if (seen === undefined) {
      seen = new Map();
      byDay.set(row.day, seen);
    }
    for (const id of idsOf(p["surfaced"])) seen.set(id, true);
    for (const id of idsOf(p["footnotes"])) if (!seen.has(id)) seen.set(id, false);
  }
  const tally = { brought: 0, used: 0 };
  const saidT = { brought: 0, used: 0 };
  const footT = { brought: 0, used: 0 };
  const perDay: (UseCount & { day: number })[] = [];
  for (let d = from; d <= day; d++) {
    const seen = byDay.get(d);
    let brought = 0;
    let used = 0;
    for (const [id, aloud] of seen ?? []) {
      const u = usedSince(src, id, d);
      brought += 1;
      if (u) used += 1;
      const t = aloud ? saidT : footT;
      t.brought += 1;
      if (u) t.used += 1;
    }
    tally.brought += brought;
    tally.used += used;
    perDay.push({ day: d, brought, used });
  }
  return { ...tally, days: day - from + 1, said: saidT, footnote: footT, perDay };
}

// ── consolidation ───────────────────────────────────────────────────────────

/**
 * What consolidation did this week, about our memories (home round 3b,
 * 2026-09-27 — a try): which came back in conversation (the returns that make
 * a memory fade more slowly, and the only ones the core lanes count), which
 * merged, and which a dream replayed (dimmer). Read from the `returns` rows by
 * source — never `legacy` — and the merge records. Who is close to the core is
 * the Self tab's; this picture does not repeat it.
 */
function consolidationPicture(src: DashboardSource, day: number): Picture {
  const store = src.store;
  const since = windowStart(day);
  const counts = store.returnCounts({ sinceDay: since });
  const awake: { id: string; day: number; times: number }[] = [];
  const dream: { id: string; day: number; times: number }[] = [];
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    const woke = row.last_return_day !== null && row.last_return_day >= since;
    const dreamt = row.last_dream_day !== null && row.last_dream_day >= since;
    if (!woke && !dreamt) continue;
    const rets = store.returnsOf(id).filter((r) => r.day >= since);
    for (const [source, into] of [["awake", awake], ["dream", dream]] as const) {
      const mine = rets.filter((r) => r.source === source);
      if (mine.length > 0) into.push({ id, day: Math.max(...mine.map((r) => r.day)), times: mine.length });
    }
  }
  // Merges: an exact duplicate folded at sleep (the survivor is `originalId`),
  // or near-copies a standing dream merged (the change's `ref` is what it made).
  const merged = new Map<string, { day: number; times: number }>();
  const addMerge = (id: string, at: number): void => {
    const cur = merged.get(id);
    merged.set(id, { day: Math.max(cur?.day ?? at, at), times: (cur?.times ?? 0) + 1 });
  };
  let merges = 0;
  for (const row of store.eventLog({ name: "memory.merged", sinceDay: since, order: "desc", limit: LOG_CEILING })) {
    const kept = payloadOf(row)["originalId"];
    merges += 1;
    if (typeof kept === "string") addMerge(kept, row.day);
  }
  for (const d of standingDreams(src).filter((x) => x.day >= since)) {
    for (const c of store.dreamChanges(d.id)) {
      if (c.action !== "merge" || c.undone !== 0) continue;
      merges += 1;
      if (c.ref !== null) addMerge(c.ref, d.day);
    }
  }
  const newest = (a: { id: string; day: number; times: number }, b: { id: string; day: number; times: number }): number =>
    b.day - a.day || b.times - a.times || (a.id < b.id ? -1 : 1);
  const groups = [
    awake.sort(newest).map((r) => ({ ...r, how: "awake" as const })),
    [...merged.entries()].map(([id, m]) => ({ id, ...m })).sort(newest).map((r) => ({ ...r, how: "merged" as const })),
    dream.sort(newest).map((r) => ({ ...r, how: "dream" as const })),
  ];
  // Each kind that happened keeps a row (conversation up to three, a merge and
  // a replay one each); the rest of the rows go to whatever is left, in order.
  const seen = new Set<string>();
  const picked: (typeof groups)[number][number][] = [];
  const take = (g: (typeof groups)[number], most: number): void => {
    for (const r of g) {
      if (picked.length >= PICTURE_ROWS || most <= 0) return;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      picked.push(r);
      most -= 1;
    }
  };
  take(groups[0]!, 3);
  take(groups[1]!, 1);
  take(groups[2]!, 1);
  for (const g of groups) take(g, PICTURE_ROWS);
  const order = { awake: 0, merged: 1, dream: 2 } as const;
  const memories = picked
    .sort((a, b) => order[a.how] - order[b.how])
    .map((r) => ({ ...said(src, r.id), how: r.how, day: r.day, times: r.times }));
  return {
    kind: "consolidation",
    returns: { awake: counts.awake, dream: counts.dream, days: MECHANISM_DAYS },
    merges,
    memories,
  };
}

// ── emotional modulation ────────────────────────────────────────────────────

/**
 * The newest live memories a feeling holds higher — the census's own test
 * (`store.emotionCensus`: an emotional score above zero, or a recorded feeling
 * with strength) — each with its feelings, strongest first.
 */
function emotionalPicture(src: DashboardSource): Picture {
  const store = src.store;
  const out: Extract<Picture, { kind: "emotional" }>["memories"][number][] = [];
  const newestFirst = census(src)
    .filter((m) => !m.schema && !m.unreadable)
    .sort((a, b) => b.bornDay - a.bornDay || (a.id < b.id ? 1 : -1));
  for (const m of newestFirst) {
    const row = store.row(m.id);
    if (row === undefined) continue;
    const feelings = feelingsShown(store, m.id);
    if (!(row.emotional > 0 || feelings.some((f) => f.strength > 0))) continue;
    out.push({
      ...saidLine(m),
      bornDay: m.bornDay,
      emotional: round(row.emotional),
      feelings: [...feelings].sort((a, b) => b.strength - a.strength).slice(0, 2),
    });
    if (out.length >= PICTURE_ROWS) break;
  }
  return { kind: "emotional", memories: out };
}

// ── prospective memory ──────────────────────────────────────────────────────

/**
 * Reminders that came back this week (both rows point at the memory whose day
 * it was), newest first; the rest of the rows are the dated memories still
 * waiting for their day, soonest first.
 */
function prospectivePicture(src: DashboardSource, day: number): Picture {
  const store = src.store;
  const since = windowStart(day);
  const rows = [
    ...store.eventLog({ name: "prospective.plain", sinceDay: since, order: "desc", limit: 200 }).map((r) => ({ r, plain: true })),
    ...store.eventLog({ name: "prospective.fire", sinceDay: since, order: "desc", limit: 200 }).map((r) => ({ r, plain: false })),
  ].sort((a, b) => b.r.seq - a.r.seq);
  const seen = new Set<string>();
  const came: Extract<Picture, { kind: "prospective" }>["came"][number][] = [];
  for (const { r, plain } of rows) {
    if (r.ref === null || seen.has(r.ref)) continue;
    seen.add(r.ref);
    came.push({ ...said(src, r.ref), day: r.day, plain });
    if (came.length >= PICTURE_ROWS) break;
  }
  const today = store.getMeta("lastActiveDate");
  const from = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : "0001-01-01";
  // Every one that came back is counted, not only the rows listed.
  for (const { r } of rows) if (r.ref !== null) seen.add(r.ref);
  const ahead = store.datedMemories(from, "9999-12-31").filter((d) => !seen.has(d.id));
  const waiting = ahead
    .slice(0, Math.max(0, PICTURE_ROWS - came.length))
    .map((d) => ({ ...said(src, d.id), date: d.eventDate }));
  return { kind: "prospective", came, waiting, counts: { came: seen.size, waiting: ahead.length } };
}

// ── dreaming ────────────────────────────────────────────────────────────────

/** A dream's change, in a few words (the dream journal on the Self tab says it in full). */
const DREAM_DID: Readonly<Record<string, string>> = {
  merge: "merged near-copies into this",
  link: "linked it to another",
  replayed: "replayed it",
  gist: "wrote this pattern",
  contradiction: "flagged a disagreement",
  "feeling-now": "said how the feeling sits now",
  "nominate-core": "suggested it for the core",
};

/** The newest dream that stands, and the memories it changed, in the order it changed them. */
function dreamingPicture(src: DashboardSource): Picture {
  const store = src.store;
  const last = standingDreams(src)[0];
  if (last === undefined) return { kind: "dreaming", dream: null, memories: [] };
  const changes = store.dreamChanges(last.id).filter((c) => c.undone === 0);
  const seen = new Set<string>();
  const memories: (Said & { did: string })[] = [];
  for (const c of changes) {
    if (c.ref === null || seen.has(c.ref)) continue;
    seen.add(c.ref);
    memories.push({ ...said(src, c.ref), did: DREAM_DID[c.action] ?? c.action });
    if (memories.length >= PICTURE_ROWS) break;
  }
  return {
    kind: "dreaming",
    dream: { id: last.id, date: last.date, day: last.day, title: last.title, changes: changes.length },
    memories,
  };
}

// ── episodic → semantic ─────────────────────────────────────────────────────

/** The patterns standing dreams wrote as memories of their own, newest first. */
function gistPicture(src: DashboardSource): Picture {
  const gists: Extract<Picture, { kind: "episodic-semantic" }>["gists"][number][] = [];
  for (const d of standingDreams(src)) {
    for (const c of src.store.dreamChanges(d.id)) {
      if (c.action !== "gist" || c.undone !== 0 || c.ref === null) continue;
      gists.push({ ...said(src, c.ref), day: d.day, date: d.date });
      if (gists.length >= PICTURE_ROWS) return { kind: "episodic-semantic", gists };
    }
  }
  return { kind: "episodic-semantic", gists };
}

// ── salience ────────────────────────────────────────────────────────────────

/**
 * The memories written this week, MOST SALIENT first, with the score each was
 * written with — and how many were written, so the page can say these are the
 * top of that many. (It showed the newest five, which ranked a panel named for
 * salience by recency.)
 */
function saliencePicture(src: DashboardSource, day: number): Picture {
  const since = windowStart(day);
  const written = census(src).filter((m) => !m.schema && !m.unreadable && m.bornDay >= since);
  const memories = written
    .sort((a, b) => b.salience - a.salience || b.bornDay - a.bornDay || (a.id < b.id ? -1 : 1))
    .slice(0, PICTURE_ROWS)
    .map((m) => ({ ...saidLine(m), salience: round(m.salience), bornDay: m.bornDay, memKind: m.kind }));
  return { kind: "salience", memories, written: written.length, days: MECHANISM_DAYS };
}

// ── association ─────────────────────────────────────────────────────────────

/** The graph hubs: what the most is wired to, by summed link weight. */
function associationPicture(src: DashboardSource): Picture {
  const store = src.store;
  const weight = new Map<string, { w: number; d: number }>();
  let links = 0;
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    for (const edge of store.edgesFrom(id)) {
      links += 1;
      for (const end of [id, edge.dst]) {
        const cur = weight.get(end) ?? { w: 0, d: 0 };
        cur.w += edge.weight;
        cur.d += 1;
        weight.set(end, cur);
      }
    }
  }
  const hubs = [...weight.entries()]
    .sort((a, b) => b[1].w - a[1].w || (a[0] < b[0] ? -1 : 1))
    .slice(0, PICTURE_ROWS)
    .map(([id, v]) => ({ ...said(src, id), weight: round(v.w), degree: v.d }));
  return { kind: "association", hubs, links };
}

// ── interference ────────────────────────────────────────────────────────────

/**
 * The newest pairs of memories that disagree (2026-09-29): flagged, or settled
 * and how. Two memories a pair, so half as many pairs as the other pictures'
 * rows. Withdrawn pairs and ones closed through another are left out.
 */
function interferencePicture(src: DashboardSource): Picture {
  const pairs = src.store
    .contradictions({ limit: PICTURE_ROWS * 4 })
    .filter((p) => p.state !== "withdrawn" && p.via === null)
    .slice(0, Math.max(1, Math.floor(PICTURE_ROWS / 2)))
    .map((p) => ({
      id: p.id,
      day: p.settled_day ?? p.flagged_day,
      state: p.state,
      how: p.how,
      older: said(src, p.a),
      newer: said(src, p.b),
    }));
  return { kind: "interference", pairs };
}

// ── reconsolidation ─────────────────────────────────────────────────────────

/**
 * The last few corrections weighed against an old memory: which memory argued,
 * with which one, and how far the pressure is toward the bar it would take to
 * change it. The target is read AS IT STOOD (unfollowed), like the feed does.
 */
function reconsolidationPicture(src: DashboardSource): Picture {
  const store = src.store;
  const revisions = store.eventLog({ name: "revision.pressure", order: "desc", limit: PICTURE_ROWS }).map((row) => {
    const p = payloadOf(row);
    const targetId = typeof p["targetId"] === "string" ? p["targetId"] : (row.ref ?? "");
    const challengerId = typeof p["challengerId"] === "string" ? p["challengerId"] : "";
    const here = revealHere(store, targetId, 72);
    const pressure = typeof p["pressureAfter"] === "number" ? p["pressureAfter"] : 0;
    const bar = typeof p["bar"] === "number" ? p["bar"] : 0;
    return {
      seq: row.seq,
      day: row.day,
      target: { id: targetId, text: here.text ?? here.label, confidential: here.confidential },
      challenger: said(src, challengerId),
      pressure: round(pressure),
      bar: round(bar),
      crossed: bar > 0 && pressure >= bar,
    };
  });
  return { kind: "reconsolidation", revisions };
}

/**
 * One memory's fade, as the physics computes it: from its last use (at most
 * `FADE_BEHIND` lived days back) to `FADE_AHEAD` days past `day`, one
 * [lived day, strength] pair per day, and the first day ahead on which it falls
 * below the archive line if nobody uses it. The Forgetting panel draws a few of
 * these; the memory card draws its own one (`memory.ts`).
 */
export function fadeCurve(
  physics: MemoryPhysics,
  day: number,
): { from: number; to: number; points: [number, number][]; archiveDay: number | null } {
  const from = Math.max(physics.lastUsedDay, day - FADE_BEHIND);
  const to = day + FADE_AHEAD;
  const points: [number, number][] = [];
  let archiveDay: number | null = null;
  for (let d = from; d <= to; d++) {
    const s = strength(physics, d);
    points.push([d, round(s)]);
    if (archiveDay === null && d > day && s < TUNABLES.PHI_PRUNE) archiveDay = d;
  }
  return { from, to, points, archiveDay };
}

/**
 * The first lived day within `horizon` days ahead on which prune's own verdict
 * (`physics#pruneVerdict`: under the floor, long enough unused, episodic, not
 * protected, not a date that still repeats) would let this memory go if nobody
 * used it — or null. `recurring` is the row's own repeat (`store#recurrenceOfRow`
 * !== null), passed the way `sleep/prune.ts` passes it, so a live repeat never
 * has a let-go day (2026-10-09). The revision-chain gate is not checked here
 * (it needs the store), so this can only say "sooner than it will be", never
 * "later".
 */
export function letGoDay(physics: MemoryPhysics, day: number, horizon: number, recurring = false): number | null {
  // Unused, strength only falls: still over the floor at the horizon means never inside it.
  if (strength(physics, day + horizon) >= TUNABLES.PHI_PRUNE) return null;
  for (let d = day; d <= day + horizon; d++) {
    if (pruneVerdict(physics, d, { inLiveRevisionChain: false, recurring }).prune) return d;
  }
  return null;
}

function round(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0;
}

