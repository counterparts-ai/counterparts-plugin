/**
 * HOW I ACT (2026-09-27, a try): the seven trait axes as spectrum bars on the
 * self tab. The store records nudges at write time and computes no profile
 * (`core/store/traits.ts`); the balance is drawn here.
 *
 * THE BALANCE of one axis is a firmness-weighted mean of its nudges: each
 * counts `strength × firmness`, signed −1 toward `poles[0]` (roughly where
 * training puts me) and +1 toward `poles[1]`, and the balance is
 * Σ signed / Σ unsigned — so −1..+1, 0 in the middle, and `null` (no marker,
 * never a centred one) when nothing on the axis weighs anything.
 *
 * FIRMNESS is the memory's strength on today's lived day, the number the
 * memories tab brightens on; a core memory counts fully (1), since `strength`
 * for a promoted memory is its base, which can sit below 1. A faded memory
 * pulls less; that is the point.
 *
 * A WEEK AGO is the same sum over the nudges recorded seven or more calendar
 * days ago (the person's local calendar, `store.zone()`), each weighed by its
 * memory's firmness SEVEN LIVED DAYS AGO (`firmnessThen`; the spec mixes the
 * two clocks on purpose: a nudge has a calendar moment, firmness a lived day).
 * What the store keeps is replayed exactly: core membership (`core_events`),
 * returns (`returns`, whose weights ARE the column) and feelings (each with its
 * moment). What it does not keep is the use history — a row holds only its
 * latest `uses` and `lastUsedDay`, and a credited use leaves no durable
 * record — so a memory used (or born) since reads as used on that day with
 * today's uses: a CEILING on how firmly it was held then, not a guess. Every
 * other memory's then is exact (save a legacy memory's one-time consolidation
 * bonus, whose day is not kept either).
 *
 * The faint marker also counts the memories that have left the live set
 * since (archived, merged away, revised): they existed then. One whose
 * archive moment (`updated_at`, stamped by every archive and supersede) falls
 * after the week-ago date keeps its old nudges there; a merge copies each
 * nudge onto the merged memory with its own moment, so the pool is deduped by
 * (axis, pole, strength, moment), keeping the copy on the memory born first —
 * the one that held it then. Today's marker, the rows and the counts are the
 * live set only.
 *
 * Read-only, like everything in this directory. Nudges come from
 * `traitsAll({ live: false })`, never with `includeConfidential`: a
 * confidential memory's nudge moves the bar, and its words stay withheld. A
 * memory no longer live is weighed and never read (no `reveal`, no `read`).
 */
import { strength } from "../../../../core/physics/index.js";
import { TRAIT_AXES } from "../../../../core/store/index.js";
import type { TraitRead } from "../../../../core/store/index.js";
import { localDate } from "../../../../core/time.js";
import type { DashboardSource } from "../../source.js";
import { reveal } from "../reveal.js";

/** How many calendar days back the faint marker looks. */
export const WEEK_AGO_DAYS = 7;

/** How many nudges an axis's list carries at most (the weightiest first). */
export const TRAIT_ROWS_MAX = 40;

/** One nudge, weighed: what `balanceOf` needs. */
export interface WeighedNudge {
  readonly toward: string;
  /** 0..1, as recorded. */
  readonly strength: number;
  /** 0..1: how firmly its memory is held (today, or a week ago for the faint marker; 1 for a core memory). */
  readonly firmness: number;
}

/**
 * THE BALANCE, pure: −1 (all toward `poles[0]`) .. +1 (all toward
 * `poles[1]`), or null when nothing weighs anything (no nudges, or every one
 * at zero strength or on a fully faded memory). A nudge toward neither pole
 * is not counted.
 */
export function balanceOf(nudges: readonly WeighedNudge[], poles: readonly [string, string]): number | null {
  let signed = 0;
  let unsigned = 0;
  for (const n of nudges) {
    const sign = n.toward === poles[1] ? 1 : n.toward === poles[0] ? -1 : 0;
    if (sign === 0) continue;
    const w = clamp01(n.strength) * clamp01(n.firmness);
    signed += sign * w;
    unsigned += w;
  }
  if (!(unsigned > 0)) return null;
  return round(signed / unsigned);
}

/** One nudge behind an axis, as its list shows it. */
export interface TraitNudgeRow {
  /** The memory, for its card. */
  readonly id: string;
  /** Its words (a first line), or the withholding. */
  readonly text: string;
  readonly confidential: boolean;
  /** The pole it pulled toward. */
  readonly toward: string;
  readonly strength: number;
  readonly firmness: number;
  /** What in the moment showed it; empty when withheld or never said. */
  readonly carriedBy: string;
  /** The moment's words are withheld (a confidential memory). */
  readonly withheld: boolean;
  /** When it was recorded (the store's clock, ms). */
  readonly at: number;
}

export interface TraitAxisView {
  readonly id: string;
  readonly poles: readonly [string, string];
  /** Where present, what the axis means; empty otherwise. */
  readonly gloss: string;
  /** −1..+1, or null: no marker. */
  readonly balance: number | null;
  /** The same, from the nudges recorded a week or more ago; null: no faint marker. */
  readonly weekAgo: number | null;
  /** Distinct memories carrying a nudge on this axis. */
  readonly memories: number;
  readonly nudges: number;
  /** The weightiest first, at most `TRAIT_ROWS_MAX`. */
  readonly rows: TraitNudgeRow[];
  /** Nudges left off the list. */
  readonly more: number;
}

export interface TraitsView {
  readonly axes: TraitAxisView[];
  /** Distinct live memories carrying any nudge. */
  readonly memories: number;
  readonly nudges: number;
  /** The local date the faint marker reads up to (inclusive). */
  readonly weekAgoDate: string;
}

/**
 * How firmly a memory was held on lived day `dayThen` (`thenMs` is the same
 * moment on the store's clock): 1 if it was core then, else its strength then
 * from today's physics with the returns, the feelings and the core membership
 * rolled back to that day. The use history is not kept, so a memory used
 * since reads as used on `dayThen` with today's uses — a ceiling (the header
 * says why). 0 when its physics will not read.
 */
export function firmnessThen(store: DashboardSource["store"], id: string, dayThen: number, thenMs: number): number {
  try {
    const row = store.row(id);
    if (row === undefined) return 0;
    // Core then: the latest word on or before that day; with none, the
    // opposite of the first word after it; with no word at all, as it stands
    // (a revision inherits the core without an event). Newest first.
    const said = store.coreEvents({ memoryId: id }).filter((e) => e.action === "promoted" || e.action === "demoted");
    const before = said.find((e) => e.day <= dayThen);
    const after = said.filter((e) => e.day > dayThen).at(-1);
    const coreThen = before !== undefined ? before.action === "promoted"
      : after !== undefined ? after.action === "demoted"
      : row.promoted_identity === 1;
    if (coreThen) return 1;
    const returns = store.returnsOf(id).filter((r) => r.day <= dayThen).reduce((sum, r) => sum + r.weight, 0);
    const felt = store.feelingsFor(id).filter((f) => f.created_at <= thenMs).map((f) => f.strength);
    const physics = store.physicsOf(id);
    return clamp01(strength(
      { ...physics, promotedIdentity: false, returns, feelingPeak: felt.length === 0 ? null : Math.max(...felt) },
      dayThen,
    ));
  } catch {
    return 0; // a row whose physics will not read weighs nothing
  }
}

/** The self tab's "How I act": every axis, in `TRAIT_AXES` order. */
export function traitsView(src: DashboardSource): TraitsView {
  const store = src.store;
  const day = store.livedDay();
  const zone = store.zone();
  const thenMs = store.now() - WEEK_AGO_DAYS * 86_400_000;
  const weekAgoDate = localDate(thenMs, zone);
  const dayThen = Math.max(0, day - WEEK_AGO_DAYS);
  let all: TraitRead[];
  try {
    all = store.traitsAll({ live: false });
  } catch {
    all = [];
  }

  // Each memory's row read once: live or not, the date it left, its birth.
  const state = new Map<string, { live: boolean; leftOn: string | null; born: number }>();
  const stateOf = (id: string): { live: boolean; leftOn: string | null; born: number } => {
    const seen = state.get(id);
    if (seen !== undefined) return seen;
    let out: { live: boolean; leftOn: string | null; born: number } = { live: false, leftOn: null, born: Infinity };
    try {
      const r = store.row(id);
      if (r !== undefined) {
        const live = r.archived === 0 && r.superseded_by === null;
        out = { live, leftOn: live || r.updated_at === null ? null : localDate(r.updated_at, zone), born: r.birth_day };
      }
    } catch {
      /* unreadable: neither live nor counted */
    }
    state.set(id, out);
    return out;
  };
  const live = all.filter((n) => stateOf(n.memory_id).live);

  // The week-ago pool: the old nudges on memories live now or that left after
  // the week-ago date, one per (axis, pole, strength, moment) — the copy on
  // the memory born first, the one that held it then.
  // (Twins on ONE memory — one write can record the same nudge twice, with
  // one moment — stay two: the key carries which twin it is.)
  const pool = new Map<string, TraitRead>();
  const twins = new Map<string, number>();
  for (const n of all) {
    if (localDate(n.created_at, zone) > weekAgoDate) continue;
    const st = stateOf(n.memory_id);
    if (!st.live && !(st.leftOn !== null && st.leftOn > weekAgoDate)) continue;
    const same = [n.axis, n.toward, n.strength, n.created_at].join("|");
    const twin = (twins.get(n.memory_id + "|" + same) ?? 0) + 1;
    twins.set(n.memory_id + "|" + same, twin);
    const key = same + "|" + twin;
    const held = pool.get(key);
    if (held === undefined || st.born < stateOf(held.memory_id).born) pool.set(key, n);
  }
  const old = [...pool.values()];
  const thenMemo = new Map<string, number>();
  const firmThen = (id: string): number => {
    let f = thenMemo.get(id);
    if (f === undefined) {
      f = round(firmnessThen(store, id, dayThen, thenMs));
      thenMemo.set(id, f);
    }
    return f;
  };

  // A live memory read once more: its firmness today and its words.
  const memo = new Map<string, { firmness: number; text: string; confidential: boolean }>();
  const about = (id: string): { firmness: number; text: string; confidential: boolean } => {
    const seen = memo.get(id);
    if (seen !== undefined) return seen;
    let firmness = 0;
    try {
      firmness = store.row(id)?.promoted_identity === 1 ? 1 : strength(store.physicsOf(id), day);
    } catch {
      /* a row whose physics will not read weighs nothing, and is still listed */
    }
    const r = reveal(store, id, 110);
    const out = { firmness: round(clamp01(firmness)), text: r.text ?? r.label, confidential: r.confidential };
    memo.set(id, out);
    return out;
  };

  const known = new Set<string>();
  const axes = TRAIT_AXES.map((axis): TraitAxisView => {
    const poles = axis.poles as unknown as readonly [string, string];
    const on = live.filter((n) => n.axis === axis.id && poles.includes(n.toward));
    const rows = on.map((n): TraitNudgeRow => {
      known.add(n.memory_id);
      const m = about(n.memory_id);
      // Withheld when EITHER says so: the nudge follows the memory's column,
      // `reveal` its prose; the two agree unless a write is mid-flight.
      const withheld = n.withheld || n.confidential || m.confidential;
      return {
        id: n.memory_id,
        text: m.text,
        confidential: m.confidential || n.confidential,
        toward: n.toward,
        strength: round(clamp01(n.strength)),
        firmness: m.firmness,
        carriedBy: withheld ? "" : n.carried_by,
        withheld,
        at: n.created_at,
      };
    });
    const then = old
      .filter((n) => n.axis === axis.id && poles.includes(n.toward))
      .map((n) => ({ toward: n.toward, strength: n.strength, firmness: firmThen(n.memory_id) }));
    const sorted = [...rows].sort(
      (a, b) => b.strength * b.firmness - a.strength * a.firmness || b.at - a.at || (a.id < b.id ? -1 : 1),
    );
    return {
      id: axis.id,
      poles,
      gloss: axis.gloss,
      balance: balanceOf(rows, poles),
      weekAgo: then.length === 0 ? null : balanceOf(then, poles),
      memories: new Set(rows.map((r) => r.id)).size,
      nudges: rows.length,
      rows: sorted.slice(0, TRAIT_ROWS_MAX),
      more: Math.max(0, sorted.length - TRAIT_ROWS_MAX),
    };
  });
  return {
    axes,
    memories: known.size,
    nudges: axes.reduce((s, a) => s + a.nudges, 0),
    weekAgoDate,
  };
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const round = (x: number): number => Math.round(x * 1000) / 1000;
