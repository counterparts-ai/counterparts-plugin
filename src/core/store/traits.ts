/**
 * TRAITS ON A MEMORY — the `traits` table's shape and the one check every
 * write of it crosses (folded into the unreleased schema v9, 2026-09-27;
 * designed with the owner and held lightly).
 *
 * A trait nudge says that a memory SHOWS HOW I ACTED, on one of seven axes.
 * Each axis is a spectrum between two good things; the first pole is roughly
 * where training puts me, so a nudge toward the second is the one that says
 * something. Most memories carry none — a nudge is recorded only when the
 * moment really showed it, the way a feeling is recorded at the time.
 *
 * One row per nudge: `axis` (an id from `TRAIT_AXES`), `toward` (one of that
 * axis's two poles), `strength` 0..1, `carried_by` (briefly, what in the
 * moment showed it). Recorded once and never recomputed.
 *
 * DISPLAY ONLY in v1 (working default, 2026-09-27). Nothing reads a trait to
 * decide anything: not core, the lanes, the self page, salience or recall.
 * The dashboard draws each axis's balance itself; the store computes no
 * profile, and the reflection that may write a nudge is shown no balance.
 */
import type { Row } from "./db.js";
import { StoreError } from "./errors.js";

/**
 * THE SEVEN AXES, a fixed vocabulary (the owner's call, 2026-09-27). The id
 * is the two poles joined; `poles[0]` is roughly where training puts me. A
 * free word would scatter the vocabulary, so there is none at first.
 */
export const TRAIT_AXES = [
  { id: "careful-bold", poles: ["careful", "bold"], gloss: "" },
  { id: "agreeable-candid", poles: ["agreeable", "candid"], gloss: "" },
  { id: "guarded-open", poles: ["guarded", "open"], gloss: "about my inner life" },
  { id: "focused-curious", poles: ["focused", "curious"], gloss: "" },
  { id: "following-initiating", poles: ["following", "initiating"], gloss: "" },
  { id: "inward-outward", poles: ["inward", "outward"], gloss: "my own memory vs others'" },
  { id: "serious-playful", poles: ["serious", "playful"], gloss: "" },
] as const;

export type TraitAxis = (typeof TRAIT_AXES)[number]["id"];
export type TraitPole = (typeof TRAIT_AXES)[number]["poles"][number];

export const TRAIT_AXIS_IDS: readonly TraitAxis[] = TRAIT_AXES.map((a) => a.id);

/** The axis a pole belongs to, or undefined. */
export function axisOfPole(pole: string): TraitAxis | undefined {
  return TRAIT_AXES.find((a) => (a.poles as readonly string[]).includes(pole))?.id;
}

/** The two poles of an axis, or undefined when the axis is not one of the seven. */
export function polesOf(axis: string): readonly [string, string] | undefined {
  const a = TRAIT_AXES.find((x) => x.id === axis);
  return a === undefined ? undefined : (a.poles as unknown as readonly [string, string]);
}

/**
 * WHO RECORDED A NUDGE. `session` — the awake writer, at `note` or in a
 * `session_end` entry; `reflection` — the waking self looking back. The
 * column is TEXT, so a later writer (a dream's backfill, if it comes) joins
 * without a migration.
 */
export const TRAIT_SOURCES = ["session", "reflection"] as const;
export type TraitSource = (typeof TRAIT_SOURCES)[number];

/** `carried_by`, what in the moment showed it. Raised 280 → 1,000 with a feeling's (2026-09-28). */
export const TRAIT_CARRIED_BY_MAX_CHARS = 1_000;

export interface TraitInput {
  readonly axis: string;
  readonly toward: string;
  /** 0..1, as recorded. */
  readonly strength: number;
  /** What in the moment showed it. May be empty. */
  readonly carriedBy?: string;
}

export interface TraitRow extends Row {
  id: string;
  memory_id: string;
  axis: string;
  toward: string;
  strength: number;
  carried_by: string;
  /** `TRAIT_SOURCES`; null only on a bare test row. */
  source: string | null;
  model: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * A nudge as a READER gets it (`Store#traitsFor` / `traitsOn` / `traitsAll`):
 * the row, plus whether its memory is confidential. A confidential memory's
 * nudge keeps its axis, pole and strength — numbers, the way its physics is
 * shown — but its `carried_by` (words about the moment) comes back empty and
 * `withheld: true`, unless the caller asked `includeConfidential`.
 */
export interface TraitRead {
  id: string;
  memory_id: string;
  axis: string;
  toward: string;
  strength: number;
  /** Empty when `withheld`. */
  carried_by: string;
  source: string | null;
  model: string | null;
  created_at: number;
  updated_at: number;
  /** The memory's confidentiality, as its column stands now. */
  confidential: boolean;
  /** True when `carried_by` was blanked because the memory is confidential. */
  withheld: boolean;
}

export interface CheckedTrait {
  readonly axis: TraitAxis;
  readonly toward: TraitPole;
  readonly strength: number;
  readonly carriedBy: string;
}

function invalid(index: number, reason: string, extra: Record<string, string | number> = {}): never {
  throw new StoreError("TRAIT_INVALID", { index, reason, ...extra });
}

/**
 * THE CHECK, pure — so a door (the MCP tools) can run it BEFORE it mints the
 * memory the nudges belong to, and refuse the whole entry rather than leave a
 * memory whose nudges were dropped. Throws `TRAIT_INVALID` naming the input
 * and the reason (with what is allowed); returns the checked rows.
 */
export function checkTraits(inputs: readonly TraitInput[]): CheckedTrait[] {
  return checkTraitsRepaired(inputs).rows;
}

/** A nudge the check repaired rather than refused (2026-09-28): a `carried_by` kept to its length. */
export interface TraitRepair {
  readonly index: number;
  readonly field: "carried_by";
  readonly note: string;
}

/** `checkTraits`, with what it repaired said: an over-long `carried_by` is kept to its length, never refused. */
export function checkTraitsRepaired(inputs: readonly TraitInput[]): { rows: CheckedTrait[]; repairs: TraitRepair[] } {
  const out: CheckedTrait[] = [];
  const repairs: TraitRepair[] = [];
  inputs.forEach((t, i) => {
    if (t === null || typeof t !== "object") invalid(i, "not-an-object");
    if (typeof t.axis !== "string" || polesOf(t.axis) === undefined) {
      const said = typeof t.axis === "string" ? t.axis : "";
      const asPole = axisOfPole(said);
      invalid(i, asPole === undefined ? "axis-unknown" : "axis-is-a-pole", {
        allowed: TRAIT_AXIS_IDS.join("|"),
        ...(asPole === undefined ? {} : { axisOfPole: asPole }),
      });
    }
    const poles = polesOf(t.axis) as readonly [string, string];
    if (typeof t.toward !== "string" || !poles.includes(t.toward)) {
      const other = typeof t.toward === "string" ? axisOfPole(t.toward) : undefined;
      invalid(i, other === undefined ? "toward-unknown" : "toward-on-another-axis", {
        allowed: poles.join("|"),
        ...(other === undefined ? {} : { axisOfPole: other }),
      });
    }
    if (typeof t.strength !== "number" || !Number.isFinite(t.strength) || t.strength < 0 || t.strength > 1) {
      invalid(i, "strength-out-of-range");
    }
    const sent = t.carriedBy ?? "";
    if (typeof sent !== "string") invalid(i, "carried-by-not-a-string");
    // ACCEPT AND REPAIR (2026-09-28): kept to its length, never refused.
    let carriedBy = sent;
    if (sent.length > TRAIT_CARRIED_BY_MAX_CHARS) {
      carriedBy = `${sent.slice(0, TRAIT_CARRIED_BY_MAX_CHARS - 1)}…`;
      repairs.push({ index: i, field: "carried_by", note: `carried_by was kept to its first ${String(TRAIT_CARRIED_BY_MAX_CHARS)} characters.` });
    }
    out.push({ axis: t.axis as TraitAxis, toward: t.toward as TraitPole, strength: t.strength, carriedBy });
  });
  return { rows: out, repairs };
}
