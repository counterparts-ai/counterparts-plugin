/**
 * Consolidation, and the ONE place identity promotion happens.
 *
 * Redesigned 2026-09-26 with the owner (dreaming + consolidation). Two jobs:
 *
 * 1. **The LEGACY consolidation marking.** Until schema v8 a memory that had
 *    survived a lived day at or above the semantic floor was marked
 *    `consolidated`, worth a one-time `+CONS_BONUS` to `base` for the rest of
 *    its life. That path is now open ONLY to memories born before the upgrade
 *    (`legacy`, physics §5.2) — exactly the rows that had it — so the upgrade
 *    moves nothing down a band and prunes nothing sooner. Every memory made
 *    since earns durability from RETURNS instead (physics §5.11): each spaced
 *    return slows its fading, credited at the moment of the use (or of a
 *    dream's replay), not here. The criterion is still physics'
 *    (`consolidationEligibility`), and a post-upgrade memory is refused
 *    `not-legacy` by it.
 *
 * 2. **Core promotion — HERE AND ONLY HERE**, now by LANES (physics §5.3):
 *    only a memory about me or about us can become core — by its MARK (v9,
 *    2026-09-27, set by an awake model that read it; since 2026-10-11 `me` or
 *    `us`, of kind self, person or entity, and not a plan: `aboutMe` below) —
 *    by the fast lane (strongly felt, and it came back after a gap) or the
 *    slow lane, the recurrence lane since 2026-10-11 (it or its slot kept
 *    coming back, in several sessions, inside a trailing month:
 *    `coreRecurrence`).
 *    Physics decides eligibility; this phase reads the mark, honours the
 *    owner's demotions, and caps the
 *    night at `CORE_MAX_PER_SLEEP`, strongest first — the rest wait for the
 *    next consolidation. The crossing is an EXPLICIT, COUNTED EVENT with a
 *    persisted record carrying its lane, never an emergent side effect of a
 *    number drifting past a line (scar §2.4). Nothing is born into identity;
 *    this and revision inheritance are the only two doors, and a dream's
 *    nomination is not one (`core/dream/`).
 *
 * 3. **The core weighs itself** (2026-10-11, Group 3 part A): a core member
 *    that is no longer about me or us, or that has not recurred for
 *    `CORE_QUIET_DAYS`, is FLAGGED "being reconsidered" — never demoted here
 *    (`core-standing.ts#weighCore`). A decision demotes it, mine or the
 *    owner's.
 *
 * Arithmetic only: this phase never calls a model.
 */

import { TUNABLES as PHYSICS_TUNABLES, consolidationEligibility, promote, promotionEligibility, strength } from "../physics/index.js";
import { IDENTITY_ABOUT_MARKS, IDENTITY_KINDS, LATER_FEELING_SOURCES, PLAN_STATUSES, defaultStrength, isSelfRelevantFeeling } from "../store/index.js";
import type { CoreContext, MemoryPhysics, PromotionCrossing, PromotionReason, Recurrence } from "../physics/index.js";
import { rowToPhysics } from "../store/operational.js";
import type { MemoryRow } from "../store/operational.js";
import { weighCore } from "./core-standing.js";
import { readCursor, resumeIndex, writeCursor } from "./markers.js";
import { PROMOTION_RECORD_PREFIX, TUNABLES } from "./tunables.js";
import type { Phase, PhaseCtx, PhaseOutcome, PromotionRecord, SleepStore } from "./types.js";

/** The two reads "who is this about" needs — a read-only store has both. */
export type ReadsDocs = Pick<SleepStore, "list" | "read">;
import { countSkip, emptyOutcome, isJournal } from "./types.js";

/** This phase's own name, for the cursor it keeps. Typed, so a rename in the
 *  phase vocabulary fails `tsc` here rather than reading an empty cursor. */
const CONSOLIDATE_PHASE: Phase = "consolidate";

export const CONSOLIDATION_SKIPS = [
  // The three housekeeping entries. The rest of this list IS physics' reason
  // vocabulary, so a reason cannot drift between the two.
  "archived",
  "removed",
  "journal",
  "not-legacy",
  "already-consolidated",
  "born-today",
  "below-semantic-floor",
] as const;

export type ConsolidationSkip = (typeof CONSOLIDATION_SKIPS)[number];

export interface ConsolidateResult extends PhaseOutcome {
  readonly consolidated: readonly string[];
  readonly promoted: readonly PromotionRecord[];
  /** Core memories flagged "being reconsidered" this run, with the reason category (2026-10-11). Never demoted here. */
  readonly reconsidering: readonly { readonly id: string; readonly reason: string }[];
  /** Core memories whose flag this run lifted because its cause went away (2026-10-11). */
  readonly reaffirmed: readonly string[];
  /** Every blocking promotion reason, counted. "Never asked" is not "refused". */
  readonly promotionBlocked: Readonly<Record<string, number>>;
}

export function promotionRecordKey(id: string): string {
  return `${PROMOTION_RECORD_PREFIX}${id}`;
}

/**
 * Is this the SELF PAGE's row? Read structurally rather than by importing
 * `self/page.ts` — `sleep/` depends on nothing in `self/`, and a shape check
 * that fails reads as "not the page", which is master's behaviour and therefore
 * the safe direction. The role string's owner is `self/page.ts#SELF_PAGE_ROLE`.
 */
function isThePage(store: PhaseCtx["store"], id: string): boolean {
  try {
    return store.read(id).doc.meta["role"] === "page";
  } catch {
    return false;
  }
}

/**
 * The OWNER's names, read off the identity core — the one `kind: "self"`
 * schema row with `role: "entity"`, which install seeds with the owner's name
 * (`self/identity.ts#IDENTITY_CORE_ROLE`, `init --name`). Read structurally for
 * `isThePage`'s reason. Lower-cased; empty when no core was ever named, and then
 * no `person` memory can be told to be about him and only `self` qualifies.
 */
export function ownerNames(store: ReadsDocs): string[] {
  const out: string[] = [];
  for (const id of store.list({ type: "schema", kind: "self", archived: false })) {
    try {
      const meta = store.read(id).doc.meta;
      if (meta["role"] !== "entity") continue;
      const add = (v: unknown): void => {
        if (typeof v === "string" && v.trim().length >= 2) out.push(v.trim().toLowerCase());
      };
      add(meta["name"]);
      const aliases = meta["aliases"];
      if (Array.isArray(aliases)) for (const a of aliases) add(a);
    } catch {
      continue;
    }
  }
  return [...new Set(out)];
}

/** Does `text` name any of `names` as a whole word (case-insensitive)? */
function names(text: string, owner: readonly string[]): boolean {
  const lower = text.toLowerCase();
  for (const n of owner) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(lower)) return true;
  }
  return false;
}

/**
 * IS THIS MEMORY ABOUT ME OR ABOUT US? — the core's first question, answered
 * BY MEANING since v9 (2026-09-27): the memory's `about` mark, set by an awake
 * model that read the words (the writer at `note` / `session_end`, or the
 * reflection) — or by the v9 upgrade, which carried the old kind rule onto the
 * rows it found. A `self` memory with no mark is a work lesson until something
 * that read it says otherwise (rule A), and an `entity` memory marked `me` —
 * someone asking to be remembered through me — is a candidate.
 *
 * NARROWED 2026-10-11 (Group 3 part A; review 08 C2, item 14): the mark is
 * `me` or `us` (`owner` is about him — his card, not who I am), the kind is
 * self, person or entity (a fact, a skill or a place never: the craft is how I
 * work, a fact is a fact), and it is not a plan (`planned`, `proposed` or
 * `asked`: what we mean to do is not who we are). `identityBlock` says which
 * part failed; the core members it moves out are flagged, never demoted here.
 *
 * The signature is the old one, so every reader (the dashboard's views among
 * them) asks the same question.
 */
export function aboutMe(
  store: ReadsDocs,
  row: Pick<MemoryRow, "id" | "kind"> & { about?: string | null; status?: string | null },
  owner?: readonly string[],
): boolean {
  void owner;
  return identityBlock(store, row) === null;
}

/** Why a memory is not one the core is for (`identityBlock`). */
export type IdentityBlock = "not-about-me-or-us" | "not-a-core-kind" | "a-plan";

/**
 * WHICH PART OF "ABOUT ME OR US" FAILS, or null when none does (2026-10-11):
 * the mark first, then the kind, then the plan. The category a flagged core
 * member carries (`core-standing.ts`).
 */
export function identityBlock(
  store: ReadsDocs,
  row: Pick<MemoryRow, "id" | "kind"> & { about?: string | null; status?: string | null },
  opts: { readonly unmarkedPasses?: boolean } = {},
): IdentityBlock | null {
  const mark = aboutMark(store, row);
  // `unmarkedPasses` (the core weighing its members): an UNMARKED member came
  // in by recognition, or before marks — nothing says it is not about me.
  const unmarkedOk = opts.unmarkedPasses === true && (mark === null || mark === undefined);
  if (!unmarkedOk && (typeof mark !== "string" || !(IDENTITY_ABOUT_MARKS as readonly string[]).includes(mark))) return "not-about-me-or-us";
  if (!IDENTITY_KINDS.includes(row.kind)) return "not-a-core-kind";
  if (isPlan(store, row)) return "a-plan";
  return null;
}

/** Is it a plan — `planned`, `proposed` or `asked` (v12's `status`)? */
function isPlan(store: ReadsDocs, row: Pick<MemoryRow, "id"> & { status?: string | null }): boolean {
  let status: string | null | undefined = row.status;
  if (status === undefined) {
    try {
      status = (store as Partial<Pick<SleepStore, "row">>).row?.(row.id)?.status ?? null;
    } catch {
      status = null;
    }
  }
  return typeof status === "string" && (PLAN_STATUSES as readonly string[]).includes(status);
}

/** The memory's `about` mark as it stands — null when nothing marked it, undefined when it cannot be read. */
function aboutMark(store: ReadsDocs, row: Pick<MemoryRow, "id"> & { about?: string | null }): string | null | undefined {
  if (row.about !== undefined) return row.about;
  try {
    return store.read(row.id).about ?? null;
  } catch {
    return undefined;
  }
}

/**
 * RECOGNITION COUNTS AS ABOUT ME (wheel v2, 2026-09-30, working default): a
 * memory NOBODY has marked (`about` null) that carries a feeling of the
 * recognition group — recognising myself in something — is one the fast lane
 * may read as about me (`CoreContext.selfRelevantFeeling`). A mark always
 * wins: `work` or `world` keeps it out. Never a `skill`. False when the port
 * cannot read feelings.
 *
 * Which feeling counts (the review of #301, M1): MINE (`whose = self` — it
 * is my recognising), felt strongly ON ITS OWN (its strength at least
 * `CORE_FAST_FEELING`, not merely a strong memory carrying a faint one), and
 * recorded in a session — or by a reflection, only while the fast lane's
 * door to reflected feelings is open (`acceptsReflectedFeeling`). A dream's
 * never: a dream may nominate, it does not open a lane.
 */
export function selfRelevantFeeling(
  store: ReadsDocs & Pick<SleepStore, "feelingsFor">,
  row: Pick<MemoryRow, "id" | "kind"> & { about?: string | null; status?: string | null },
  acceptsReflected: boolean,
): boolean {
  // A core kind, not a plan (2026-10-11): the same narrowing as `aboutMe`.
  if (!IDENTITY_KINDS.includes(row.kind) || store.feelingsFor === undefined) return false;
  if (aboutMark(store, row) !== null || isPlan(store, row)) return false;
  try {
    return store
      .feelingsFor(row.id)
      .some(
        (f) =>
          f.whose === "self" &&
          // Strongly felt by its own word's measure since 2026-10-10 (08 C3:
          // "also apply it to the recognition door").
          feelingIsStrong(f) &&
          (f.source === null || f.source === "session" || ((LATER_FEELING_SOURCES as readonly (string | null)[]).includes(f.source) && acceptsReflected)) &&
          isSelfRelevantFeeling(f.emotion, f.other_word),
      );
  } catch {
    return false;
  }
}

/** One stored feeling, as `feelingIsStrong` reads it. */
type FeltRow = { readonly strength: number; readonly core: string; readonly emotion: string; readonly other_word?: string | null };

/**
 * IS THIS FEELING STRONGLY FELT? (2026-10-10, Group 1c; review 08 C3) — at
 * `CORE_FAST_FEELING`, or — at `CORE_FAST_RELATIVE_FLOOR` (0.5) or more — at least `CORE_FAST_ABOVE_DEFAULT` above its own
 * word's default as the store writes it (`store/feelings.ts#defaultStrength`:
 * the word's intensity, capped at `DEFAULT_STRENGTH_CAP` 0.55 so a feeling
 * nobody weighed never reaches the lane on its own — the review of #301, m2,
 * which this keeps). A word written without a number is stored at that
 * default, so it is not strongly felt; a writer who raised it is. The fast
 * lane shut on day 10 because every core's default sits at or under 0.55.
 */
export function feelingIsStrong(f: FeltRow): boolean {
  if (!(f.strength >= 0)) return false;
  if (f.strength >= PHYSICS_TUNABLES.CORE_FAST_FEELING) return true;
  const ownDefault = defaultStrength(f.core, f.emotion, f.other_word ?? null);
  // A hair of tolerance: 0.6 − 0.5 is 0.0999… in floating point.
  // And at least `CORE_FAST_RELATIVE_FLOOR` (review of #369): a low word raised a little is not strong.
  return f.strength >= PHYSICS_TUNABLES.CORE_FAST_RELATIVE_FLOOR && f.strength - ownDefault >= PHYSICS_TUNABLES.CORE_FAST_ABOVE_DEFAULT - 1e-9;
}

/**
 * THE FAST LANE'S "STRONGLY FELT", READ OFF THE FEELINGS (2026-10-10,
 * `CoreContext.stronglyFelt`): any feeling on the memory, his or mine, that
 * `feelingIsStrong` — the same feelings the lane's intensity reads, so with
 * the door to later feelings closed a reflection's or an awake one is left
 * out (`LATER_FEELING_SOURCES`, as `feeling_peak_lived` leaves them out).
 * False when the port cannot read feelings.
 */
export function stronglyFelt(store: Pick<SleepStore, "feelingsFor">, id: string, acceptsReflected: boolean): boolean {
  if (store.feelingsFor === undefined) return false;
  try {
    return store
      .feelingsFor(id)
      .some((f) => (acceptsReflected || !(LATER_FEELING_SOURCES as readonly (string | null)[]).includes(f.source)) && feelingIsStrong(f));
  } catch {
    return false;
  }
}

/**
 * WHICH LATER FEELING CARRIED A PROMOTION (2026-10-02, review of #317): the
 * sources among `LATER_FEELING_SOURCES` with a feeling on the memory at the
 * fast lane's strength (`CORE_FAST_FEELING`, on the raw strength the peak
 * reads). Asked only when the lane would not have been met with the door
 * closed — every lived feeling fell short — so each source listed could have
 * met it alone; both may be. Undefined when the port cannot read feelings or
 * none is found (never an empty list): the record then says only
 * `feelingRecordedLater`, read as a reflection's.
 */
export function laterFeelingCarriers(store: Pick<SleepStore, "feelingsFor">, id: string): readonly ("reflection" | "awake")[] | undefined {
  if (store.feelingsFor === undefined) return undefined;
  try {
    const rows = store.feelingsFor(id);
    const out: ("reflection" | "awake")[] = [];
    for (const src of LATER_FEELING_SOURCES) {
      if (src !== "reflection" && src !== "awake") continue;
      if (rows.some((f) => f.source === src && feelingIsStrong(f))) out.push(src);
    }
    // None found (review of #319): say nothing rather than an empty list a
    // reader would credit to no one; absent reads as a reflection's.
    return out.length === 0 ? undefined : out;
  } catch {
    return undefined;
  }
}

/** The fields of a promotion record the two readers below look at, as parsed JSON. */
type LaterFeelingFields = { readonly feelingRecordedLater?: unknown; readonly feelingRecordedLaterBy?: unknown };

/**
 * Did a REFLECTION's feeling carry this promotion? `feelingRecordedLater`, with
 * `feelingRecordedLaterBy` naming a reflection — or naming no one, as on a
 * record written before #317, when no other source came through the door.
 */
export function laterFeelingWasReflections(rec: LaterFeelingFields): boolean {
  if (rec.feelingRecordedLater !== true) return false;
  const by = rec.feelingRecordedLaterBy;
  return !Array.isArray(by) || by.includes("reflection");
}

/** Did an ordinary session's feeling-now (`awake`, #317) carry this promotion? */
export function laterFeelingWasAwake(rec: LaterFeelingFields): boolean {
  const by = rec.feelingRecordedLaterBy;
  return rec.feelingRecordedLater === true && Array.isArray(by) && by.includes("awake");
}

/**
 * DOES THIS PERSON MEMORY NAME THE OWNER? — the old kind reading (title, body,
 * or its `name` / `entity` meta, whole word), kept for what it still answers
 * that is not the core's question: which memories a dream's bundle files under
 * the owner's card, and whether a flagged contradiction is his to hear.
 */
export function namesOwner(store: ReadsDocs, row: Pick<MemoryRow, "id" | "kind">, owner: readonly string[]): boolean {
  if (row.kind !== "person" || owner.length === 0) return false;
  try {
    const doc = store.read(row.id).doc;
    const meta = doc.meta;
    const fields = [doc.title ?? "", doc.body, String(meta["name"] ?? ""), String(meta["entity"] ?? "")];
    return fields.some((f) => f.length > 0 && names(f, owner));
  } catch {
    return false;
  }
}

/** Meta key: the owner opened the fast lane to feelings a reflection recorded later. */
export const REFLECTED_FEELING_KEY = "core.fast.acceptsReflectedFeeling";

/** Does the fast lane read feelings a reflection recorded later? The meta row, else the tunable. */
export function acceptsReflectedFeeling(store: Pick<SleepStore, "getMeta">): boolean {
  const v = store.getMeta(REFLECTED_FEELING_KEY);
  if (v === "1" || v === "true" || v === "on") return true;
  if (v === "0" || v === "false" || v === "off") return false;
  return PHYSICS_TUNABLES.CORE_FAST_ACCEPTS_REFLECTED_FEELING;
}

/** What `coreContextFor` reads — reads only; a read-only (observer) store has them all. */
export type ReadsCoreContext = ReadsDocs & Pick<SleepStore, "row" | "getMeta" | "returnsOf" | "coreDemoted" | "feelingsFor" | "contradictionsOf">;

/** The most memories one slot walk visits (the memory itself included). CAL. */
export const SLOT_WALK_MAX = 12;

/**
 * A MEMORY'S SLOT (2026-10-11, Group 3 part A): the memory and the live ones a
 * standing "A over B" ties it to — a SETTLED `changed` pair (a write's
 * `updates`, a settle, a dream merge, a dream fold: Group 3 part B) —
 * walked along the chain, at most `SLOT_WALK_MAX`. Not a slot proposal still
 * waiting (unconfirmed, about one in seven wrong on Group 2's hand-read: a
 * wrong one would pool another memory's uses into this one — decided by the
 * coordinator and random-06, 2026-10-11, lightly held), not an `open` pair
 * (two different things, kept apart) and not a `corrected` one (the earlier
 * was wrong, not said again). Group 2 shipped pairs, not slot ids, so this IS
 * the slot. Reads only; a port without the pairs gives the
 * memory alone.
 */
export function slotOf(store: Pick<SleepStore, "row" | "contradictionsOf">, id: string): string[] {
  const out = [id];
  if (store.contradictionsOf === undefined) return out;
  const seen = new Set(out);
  for (let i = 0; i < out.length && out.length < SLOT_WALK_MAX; i++) {
    let pairs: readonly { a: string; b: string; state: string; how: string | null; source: string; over: string | null }[] = [];
    try {
      pairs = store.contradictionsOf([out[i] as string]).get(out[i] as string) ?? [];
    } catch {
      pairs = [];
    }
    for (const p of pairs) {
      const sameThing = p.state === "settled" && p.how === "changed";
      if (!sameThing) continue;
      for (const other of [p.a, p.b]) {
        if (seen.has(other) || out.length >= SLOT_WALK_MAX) continue;
        seen.add(other);
        const r = store.row(other);
        if (r === undefined || r.archived === 1) continue;
        out.push(other);
      }
    }
  }
  return out;
}

/** The sources whose returns are a recurrence: an ordinary use, a reflection's citation (full), an engaged use (`ENGAGED_RECURRENCE_WEIGHT`). */
const RECURRENCE_SOURCES: Readonly<Record<string, "full" | "engaged">> = { awake: "full", reflection: "full", engaged: "engaged" };
/** A dream fold's row (`meta.fold`, 2026-10-11, Group 3 part B). Never throws. */
function isFoldRow(row: Pick<MemoryRow, "source" | "meta">): boolean {
  if (row.source !== "dreamed" || typeof row.meta !== "string" || !row.meta.includes('"fold"')) return false;
  try {
    return (JSON.parse(row.meta) as Record<string, unknown>)["fold"] === true;
  } catch {
    return false;
  }
}

/** Who writes no re-encoding by writing into a slot: a dream (its merge, gist or fold) and a reflection (its citation already counts). */
const NOT_REENCODING = new Set(["dreamed", "reflection"]);

/**
 * THE MEMORY'S RECURRENCE (2026-10-11, Group 3 part A; review 08 C1): over
 * its slot (`slotOf`), every lived day on which a member was used awake (an
 * engaged use counts `ENGAGED_RECURRENCE_WEIGHT` of a day, and never alone),
 * cited by a reflection, or RE-ENCODED — a member written that day, other than
 * the slot's first, by a session (a dream's or a reflection's writing is not
 * one). Dream replays never count. Read off the `returns` table and the
 * members' rows, so an undone settle takes its days with it: nothing is written for a re-encoding (no `reencoded` return row —
 * decided by the group3a builder, 2026-10-11, lightly held).
 *
 * Sessions: `returns.session` (written since 2026-10-11), a member's
 * `origin_session` for a re-encoding; a day whose evidence names no session
 * (every return before 2026-10-11) counts as one session. Windowed to the
 * trailing `CORE_SLOW_WINDOW_DAYS` ending on `day`; `lastEver` is unwindowed.
 * `anchored`: the row itself has an awake, reflection or engaged return.
 * `earlier`: a later member settled over it (`changed`) — the slot's
 * recurrence lifts its current state, so an earlier one does not cross by it.
 */
export function coreRecurrence(store: Pick<SleepStore, "row" | "returnsOf" | "contradictionsOf">, id: string, day: number): Recurrence {
  const members = slotOf(store, id);
  const rows = members.map((m) => ({ id: m, row: store.row(m) }));
  let earlier = false;
  try {
    earlier = (store.contradictionsOf?.([id]).get(id) ?? []).some((p) => p.state === "settled" && p.how === "changed" && p.over === id);
  } catch {
    earlier = false;
  }
  // The slot's first encoding is not a RE-encoding.
  let firstBorn: string | null = null;
  for (const { id: m, row } of rows) {
    if (row === undefined) continue;
    const r = rows.find((x) => x.id === firstBorn)?.row;
    if (firstBorn === null || r === undefined || row.birth_day < r.birth_day || (row.birth_day === r.birth_day && (row.created_at ?? 0) < (r.created_at ?? 0))) firstBorn = m;
  }
  // A FOLD IN THE SLOT (2026-10-11, Group 3 part B; decided by random-06,
  // 2026-10-11, lightly held): recurrence means its content came back AFTER
  // it was folded. A member already there when the slot's first fold was
  // written gives no re-encoding (its birth came before the fold existed),
  // and only its uses after the fold count; the fold's own uses, and members
  // written since, count as anywhere else.
  let foldAt: { at: number; day: number } | null = null;
  for (const { row } of rows) {
    if (row === undefined || !isFoldRow(row)) continue;
    const at = row.created_at ?? 0;
    if (foldAt === null || at < foldAt.at) foldAt = { at, day: row.birth_day };
  }
  const beforeFold = (row: MemoryRow): boolean => foldAt !== null && !isFoldRow(row) && (row.created_at ?? 0) < foldAt.at;
  const evidence: { day: number; weight: number; session: string | null }[] = [];
  let anchored = false;
  for (const { id: m, row } of rows) {
    if (row === undefined) continue;
    const folded = beforeFold(row);
    let returns: readonly { source: string; day?: number; session?: string | null; at?: number }[] = [];
    try {
      returns = store.returnsOf?.(m) ?? [];
    } catch {
      returns = [];
    }
    for (const r of returns) {
      const kind = RECURRENCE_SOURCES[r.source];
      if (kind === undefined || typeof r.day !== "number") continue;
      if (folded && foldAt !== null && (typeof r.at === "number" ? r.at < foldAt.at : r.day <= foldAt.day)) continue;
      if (m === id) anchored = true;
      evidence.push({ day: r.day, weight: kind === "full" ? 1 : PHYSICS_TUNABLES.ENGAGED_RECURRENCE_WEIGHT, session: r.session ?? null });
    }
    if (m !== firstBorn && !folded && !NOT_REENCODING.has(row.source ?? "")) evidence.push({ day: row.birth_day, weight: 1, session: row.origin_session ?? null });
  }
  const from = day - PHYSICS_TUNABLES.CORE_SLOW_WINDOW_DAYS;
  const byDay = new Map<number, number>();
  const sessions = new Set<string>();
  const namedDays = new Set<number>();
  let lastEver: number | null = null;
  for (const e of evidence) {
    if (e.day > day) continue;
    lastEver = lastEver === null ? e.day : Math.max(lastEver, e.day);
    if (e.day <= from) continue;
    byDay.set(e.day, Math.max(byDay.get(e.day) ?? 0, e.weight));
    if (e.session !== null) {
      sessions.add(e.session);
      namedDays.add(e.day);
    }
  }
  // A day whose evidence names no session counts as one of its own.
  let unnamed = 0;
  for (const d of byDay.keys()) if (!namedDays.has(d)) unnamed += 1;
  const days = [...byDay.keys()];
  let total = 0;
  let full = 0;
  for (const w of byDay.values()) {
    total += w;
    if (w >= 1) full += 1;
  }
  return {
    days: Math.round(total * 1000) / 1000,
    fullDays: full,
    sessions: sessions.size + unnamed,
    first: days.length === 0 ? null : Math.min(...days),
    last: days.length === 0 ? null : Math.max(...days),
    anchored,
    lastEver,
    ...(earlier ? { earlier: true } : {}),
  };
}

/**
 * THE CORE LANES' CONTEXT FOR ONE MEMORY (2026-09-27) — exactly what this
 * phase hands `promote`, built in one place so every reader that asks "could
 * this cross?" (the dashboard's eligibility views among them) asks it with the
 * same inputs: who it is about (its mark, `aboutMe`), whether the owner sent it
 * back out (`coreDemoted`), whether the fast lane reads a reflection's later
 * feelings (`acceptsReflectedFeeling`), and — with that door closed, for a
 * memory about me — the last day of an ordinary use (owner ruling D1 on #256:
 * closed is fully closed). `day` rides along, so the result can go straight to
 * `promotionEligibility`; `promote` sets the same day itself.
 *
 * Reads only. `acceptsReflectedFeeling` may be passed when the caller already
 * read the door once for many rows (this phase does); omitted, it is read here.
 */
export function coreContextFor(
  store: ReadsCoreContext,
  row: Pick<MemoryRow, "id" | "kind"> & { about?: string | null; status?: string | null },
  day: number,
  opts: { acceptsReflectedFeeling?: boolean } = {},
): CoreContext & { readonly day: number } {
  const reflected = opts.acceptsReflectedFeeling ?? acceptsReflectedFeeling(store);
  const about = aboutMe(store, row);
  // Read only for an unmarked memory: a marked one has already answered.
  const recognized = !about && selfRelevantFeeling(store, row, reflected);
  const candidate = about || recognized;
  // Strongly felt by the word's own measure (2026-10-10), read only where the
  // lanes can use it.
  const felt = candidate && stronglyFelt(store, row.id, reflected);
  // The recurrence lane's count (2026-10-11), read only where the lanes can use it.
  const recurrence = candidate ? coreRecurrence(store, row.id, day) : undefined;
  return {
    aboutMe: about,
    ...(recurrence === undefined ? {} : { recurrence }),
    ...(recognized ? { selfRelevantFeeling: true } : {}),
    ...(felt ? { stronglyFelt: true } : {}),
    demoted: candidate ? (store.coreDemoted?.(row.id) ?? false) : false,
    acceptsReflectedFeeling: reflected,
    // Read only where it can matter.
    ...(reflected || !candidate ? {} : { organicReturnDay: lastOrganicReturnDay(store, row.id) }),
    day,
  };
}

export function runConsolidate(ctx: PhaseCtx): ConsolidateResult {
  const out = emptyOutcome();
  for (const skip of CONSOLIDATION_SKIPS) out.skipped[skip] = 0;
  const promotionBlocked: Record<string, number> = {};
  const consolidated: string[] = [];
  const promoted: PromotionRecord[] = [];
  const reconsidering: { id: string; reason: string }[] = [];
  const reaffirmed: string[] = [];
  const block = (reason: string): void => {
    promotionBlocked[reason] = (promotionBlocked[reason] ?? 0) + 1;
    countSkip(out, `promotion:${reason}`);
  };

  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const ids = store.list();
  const reflected = acceptsReflectedFeeling(store);

  // WHERE THE LAST RUN STOPPED. `store.list()` is `ORDER BY id`, so the rotation
  // is stable and a cursor means something: this run resumes strictly after it
  // and wraps to the head once it reaches the end, visiting each id at most once
  // per run. A budget is still not a debt (§3) — the marker still advances and
  // nothing is owed; only the STARTING PLACE moved
  // (`docs/promotion-diagnosis-2026-09-17.md`).
  const start = resumeIndex(ids, readCursor(store, CONSOLIDATE_PHASE));
  let visited = 0;
  let stoppedAt: string | null = null;

  /** Tonight's eligible crossings, before the cap. */
  const eligible: { id: string; index: number; crossing: PromotionCrossing; strength: number; physics: MemoryPhysics }[] = [];

  while (visited < ids.length) {
    if (out.examined >= ctx.budget) {
      out.budgetExhausted = true;
      out.skippedForBudget = ids.length - visited;
      break;
    }
    const id = ids[(start + visited) % ids.length] as string;
    const index = visited + 1;
    visited += 1;
    stoppedAt = id;
    const row = store.row(id);
    if (row === undefined) continue;
    if (denied.has(id)) {
      countSkip(out, "removed");
      continue;
    }
    if (row.archived === 1) {
      countSkip(out, "archived");
      continue;
    }
    // A source is not consolidated and cannot cross into the identity band; the
    // MEMORY made from it can, and that is the path (`types.ts#isJournal`).
    if (isJournal(row)) {
      countSkip(out, "journal");
      continue;
    }
    out.examined += 1;

    let p = rowToPhysics(row);

    // ── 1. the legacy consolidation marking ─────────────────────────────────
    const eligibility = consolidationEligibility(p, day);
    if (!eligibility.eligible) {
      countSkip(out, eligibility.reason);
    } else {
      if (ctx.apply) store.updatePhysics(id, { consolidated: true });
      p = { ...p, consolidated: true };
      consolidated.push(id);
      out.changed += 1;
      ctx.event("sleep.consolidated", id, { kind: p.kind, day });
      ctx.step("item", { index, id });
    }

    // ── 2. the core lanes ───────────────────────────────────────────────────
    //
    // THE SELF PAGE DOES NOT CROSS (2026-09-18): it can be given the physics a
    // lane wants and would then carry `promoted_identity` on a row the wake can
    // never rank. The guard is THE PAGE, not schema rows generally — see
    // `sleep/NOTES.md` for why the identity core and beliefs are not exempted.
    if (row.type === "schema" && row.kind === "self" && isThePage(store, id)) {
      block("self-page");
      continue;
    }
    if (p.promotedIdentity) {
      block("already-identity");
      // ── 3. the core weighs itself (2026-10-11): flag, or lift a flag —
      // never demote (`core-standing.ts`).
      const w = weighCore(store, row, day);
      if (w !== null) {
        if (ctx.apply) store.appendCoreEvent?.({ memoryId: id, action: w.action, day, reason: w.reason, actor: "sleep" });
        if (w.action === "reconsidering") reconsidering.push({ id, reason: w.reason });
        else reaffirmed.push(id);
        ctx.event(w.action === "reconsidering" ? "sleep.core.reconsidering" : "sleep.core.reaffirmed", id, { reason: w.reason, day });
      }
      continue;
    }
    // Who it is about is the row's own mark (v9): no prose read. The whole
    // context is `coreContextFor`'s — one source of truth with every reader
    // that asks the same question. Closed means fully closed (owner ruling D1
    // on #256): the fast lane's return must be an ordinary use.
    const outcome = promote(p, day, coreContextFor(store, row, day, { acceptsReflectedFeeling: reflected }));
    if (!outcome.promoted || outcome.crossing === null) {
      // Every blocking reason is reported: "not about me" and "no lane yet"
      // are different diagnoses.
      for (const reason of outcome.verdict.blockedBy) block(reason);
      continue;
    }
    eligible.push({ id, index, crossing: outcome.crossing, strength: strength(p, day), physics: p });
  }

  // ── the nightly cap: strongest first, the rest wait ──────────────────────
  eligible.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  const cap = TUNABLES.CORE_MAX_PER_SLEEP;
  for (const [i, e] of eligible.entries()) {
    if (i >= cap) {
      block("cap");
      continue;
    }
    // WHERE ITS RETURNS CAME FROM (v9): the record names the sources of the
    // awake-class returns the lanes counted, so "promoted on reflection
    // alone" is a number doctor can print rather than a guess.
    const sources = returnSourcesOf(store, e.id);
    // AND WHETHER THE OPEN DOOR CARRIED IT (review of #256, S4): with the
    // fast lane open to feelings recorded later, would it still have crossed
    // with that door closed? If not, a later feeling is what carried it.
    // WHOSE (review of #317, 2026-10-02): since #317 an ordinary session's
    // feeling-now (`awake`) comes through the same door as a reflection's, so
    // the record names which could have carried it — a reflection's is shown
    // like a promotion on reflection alone, an awake one is said apart.
    const closed = reflected
      ? promotionEligibility(e.physics, { aboutMe: true, day, acceptsReflectedFeeling: false, stronglyFelt: stronglyFelt(store, e.id, false) })
      : null;
    const later = closed !== null && !closed.fast.met && !closed.slow.met;
    const by = later ? laterFeelingCarriers(store, e.id) : undefined;
    const record: PromotionRecord = {
      id: e.id,
      ...e.crossing,
      returnSources: sources,
      reflectionOnly: sources.reflection > 0 && sources.awake === 0,
      feelingRecordedLater: later,
      ...(by === undefined ? {} : { feelingRecordedLaterBy: by }),
    };
    if (ctx.apply) {
      // Record BEFORE the flag: a crossing nobody could account for afterwards
      // is exactly the emergent promotion this phase exists to replace. If the
      // record cannot be written, the memory does not cross.
      store.setMeta(promotionRecordKey(e.id), JSON.stringify(record));
      store.appendEvent?.({
        name: record.event,
        day,
        ref: e.id,
        dedupKey: promotionRecordKey(e.id),
        payload: { ...record },
      });
      store.appendCoreEvent?.({ memoryId: e.id, action: "promoted", day, lane: record.lane, actor: "sleep" });
      store.updatePhysics(e.id, { promotedIdentity: true });
      // The band column is canonical for a crossing (a decision, not a decay
      // reading), and this is the only writer of `identity`.
      store.setBand(e.id, "identity", day);
    }
    promoted.push(record);
    out.changed += 1;
    ctx.event("sleep.promoted", e.id, {
      kind: record.kind,
      lane: record.lane,
      intensity: record.intensity,
      returnDays: record.returnDays,
      day,
    });
    ctx.step("item", { index: e.index, id: e.id });
  }

  // The cursor moves only where a row was actually visited, and only under
  // `apply`: an observer's read-only report may not move the store's place in
  // the store (§5 G10).
  if (ctx.apply && stoppedAt !== null) writeCursor(store, CONSOLIDATE_PHASE, stoppedAt);

  return { ...out, consolidated, promoted, reconsidering, reaffirmed, promotionBlocked };
}

/** The last lived day of a counted ORDINARY awake return (source `awake`), or null. */
function lastOrganicReturnDay(store: Pick<SleepStore, "returnsOf">, id: string): number | null {
  let last: number | null = null;
  try {
    for (const r of (store.returnsOf?.(id) ?? []) as readonly { source: string; day?: number }[]) {
      if (r.source === "awake" && typeof r.day === "number" && (last === null || r.day > last)) last = r.day;
    }
  } catch {
    /* a store without the table reads as none */
  }
  return last;
}

/** Counted awake-class returns by source, for a promotion's record. */
function returnSourcesOf(store: PhaseCtx["store"], id: string): { awake: number; reflection: number } {
  let awake = 0;
  let reflection = 0;
  try {
    for (const r of store.returnsOf?.(id) ?? []) {
      if (r.source === "awake") awake += 1;
      else if (r.source === "reflection") reflection += 1;
    }
  } catch {
    /* a store without the table reads as no returns */
  }
  return { awake, reflection };
}

export type { PromotionReason };
