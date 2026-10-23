/**
 * `schemas/` — semantic memory.
 *
 * The entities experience organizes itself around, and the beliefs held about
 * them. Brain analog: schema formation — repeated episodes abstract into a
 * structure new experience is compared against, which is what makes prediction
 * error possible.
 *
 * FOUR PROPERTIES HOLD ACROSS THE WHOLE MODULE, each enforced rather than
 * asserted (test/schemas.test.ts proves every one):
 *
 * 1. **No operation edits a belief.** There is no such verb — `PUBLIC_SURFACE`
 *    enumerates every method, and a test asserts the class has exactly those.
 *    A belief's text changes only as the result of `physics.applyChallenge`
 *    arithmetic on a DECLARED `updates:`, and the prior text is retained by
 *    `store.supersede` (§5 G1, and the accommodation guardrail preserved by
 *    construction). `replaceCurrentState` is not an exception to that rule: it
 *    writes a SUCCESSOR from the challenging memory's own prose, on a row that
 *    is a "now" fact rather than a belief, and the prior row is retained the
 *    same way. No verb here takes new text for an EXISTING row.
 * 2. **Birth is by mention, death is by decay.** A newly-named entity becomes a
 *    stub immediately — an explicit, logged creation event, no gate and no
 *    proposal queue (owner decision 2026-08-25). A stub that never accumulates
 *    fades by ordinary physics; no model, on any path, can kill an entity
 *    (§5 G7).
 * 3. **Status lives on the entity, never in identity.** The ~72 KB lesson,
 *    mechanized at this seam as a named refusal (§3, `status-on-identity-refused`).
 * 4. **This module never promotes.** Promotion is physics'/sleep's counted
 *    crossing; here `band` is READ and nothing else. There is no `setBand` call
 *    and no promotion path in this directory, and a source scan says so.
 *
 * Ambiguities the contract left open are recorded in NOTES.md; what this module
 * needed from a neighbour and could not have is in INTERFACE-GAPS.md.
 */

import {
  applyChallenge,
  band as bandOfPhysics,
  fadeOf,
  clampSalienceAtSeam,
  pruneVerdict,
  revisionBar,
  strength as strengthOf,
  successorSeed,
  supersedeRecord,
  supportRouteWeight,
  SUPPORT_ROUTES,
  TUNABLES as PHYSICS_TUNABLES,
} from "../physics/index.js";
import type { MemoryPhysics, SupportRoute } from "../physics/index.js";
import { gateAliases } from "../encode/aliases.js";
import { containsSecret, redactSecrets } from "../encode/secrets.js";
import { nameRegex, occursAsWholeWord } from "../encode/words.js";
import { Store, hashText } from "../store/index.js";
// The WALKING read — not a `Store` method on purpose (`store/walk-seam.ts`): it
// skips the archived-read telemetry AND the deny-list, and this module is one of
// the two files `test/cli.test.ts` allows to import it.
import { readProseWalking } from "../store/walk-seam.js";
import { rowTombstoned } from "../store/index.js";
import type { BirthRoute, MemoryRow, PutInput } from "../store/index.js";
import type { Band, Kind, Salience } from "../types.js";
import { AliasIndex, collision, handleKey } from "./aliases.js";
import { TUNABLES } from "./tunables.js";
import { tallyNames } from "./names.js";
import { clearsTopicBar, isStopTag, tagPartners, tallyTags, topicsNamedIn } from "./tags.js";
import { similarity } from "../remember/updates.js";
import type { NameCount } from "./names.js";
import {
  BIRTH_KINDS,
  isBirthKind,
} from "./types.js";
import type {
  BeliefInput,
  BeliefStanding,
  BeliefOutcome,
  BeliefStory,
  BirthKind,
  BirthOutcome,
  BirthReason,
  ChallengeInput,
  CurrentStateInput,
  DimensionsInput,
  ElementView,
  EntityView,
  FadeReason,
  FadeReport,
  FadeSweepOptions,
  FadeVerdict,
  LifecycleRow,
  LineageStep,
  MentionInput,
  NamedInTextInput,
  NamedInTextReport,
  NameBirthOptions,
  NameBirthReport,
  TopicBirthReport,
  TwinMerge,
  TwinMergeReport,
  PlacementOutcome,
  PlacementReason,
  PressureIncrement,
  ReplacementOutcome,
  ReplacementReason,
  RevisionOutcome,
  RevisionReason,
  SchemaEvent,
  SchemaRole,
  SchemaSliceOut,
  SupportFileOutcome,
  SupportFileReason,
  SupportFilingInput,
} from "./types.js";

export * from "./types.js";
export { AliasIndex, collision, handleKey, nameTokens } from "./aliases.js";
export type { AliasHit, CollisionKind } from "./aliases.js";
export { TUNABLES } from "./tunables.js";
export { clearsTopicBar, isStopTag, KINDS_REPAIR_KEY, lookAlikePairs, mergeMap, nightTagWork, notSameKey, NOT_SAME_PREFIX, repairBirthKindSubjects, resolveTag, stemKey, SUBJECT_KIND_BY_PREFIX, tagPartners, tallyTags, topicsNamedIn } from "./tags.js";
export type { LookAlike, TagTally, TagsNightInput, TagsNightOutcome } from "./tags.js";

/**
 * Every public method, enumerated. The totality test asserts the class exposes
 * EXACTLY this set — so a future `editBelief` / `setBeliefText` / `promote`
 * cannot be added without editing this list, in a module whose first guarantee
 * is that no such verb exists (§5 G1, scar §2.17's "write paths ship, curation
 * paths starve" read in reverse).
 */
export const PUBLIC_SURFACE = [
  // writes
  "mention",
  "creditNamedIn",
  "addAliases",
  "addBelief",
  // 2026-10-21 (wave 2 lane C): a memory counted for or against a belief, once.
  "fileSupport",
  "addCurrentState",
  "challengeBelief",
  "replaceCurrentState",
  "fadeSweep",
  // 2026-10-22 (wave 2 follow-ups): the twin cards #578 stopped, merged once.
  "mergeTwinCards",
  // 2026-10-11 (Group 3 part D): the night's name tally offers names to `mention`.
  "birthsFromNames",
  // store v14 (2026-10-21): the card my beliefs about me and us attach to (lane C).
  "ensureSelfSubject",
  // 2026-10-21 (wave 2 lane B): a tag that matters becomes a topic card.
  "birthsFromTags",
  // reads
  "entity",
  "entities",
  "element",
  "beliefs",
  "currentState",
  // 2026-10-21 (wave 2 lane C): beliefs as they stand on a subject, and the one a birth repeats (reads).
  "beliefStanding",
  "nearestBelief",
  "slices",
  "loadSkips",
  "aliasIndex",
  "aliasMap",
  "bandOf",
  "fadeVerdict",
  "story",
  // 2026-10-11 (review of #427): a crossing's successor, read off its pressure pair (a read).
  "crossedTo",
  "lifecycle",
  "events",
  // v12 (2026-10-03): what a memory names — the store's finder, and the
  // backfill's reading (both reads; the links are the store's to write).
  "subjectsIn",
  "subjectLinksForAll",
  // 2026-10-22 (wave 2 lane E): the beliefs on the subjects a text names, for
  // recall's slot; a source's tag partners, for priming; and whether a belief
  // is about me or us, for the slot's rating (all reads).
  "beliefsNamedIn",
  "tagPartnersOf",
  "aboutMeBelief",
] as const;

const EVENT_RING = 500;

/** How many of a name's memories make the source its birth is checked against. */
const NAME_SOURCE_MEMORIES = 20;

/** The share of a removed card's live linked memories a name must cover to be its name (review of #429). */
const REMOVED_COVER = 0.8;

/**
 * A card that has looked back for its memories once (`relinkUnlinked`, review of #578): one
 * meta row per card, so a card that truly names no memory is not scanned for again every night.
 */
export const RELINKED_PREFIX = "schema.relinked.";

/** The twin pass ran on this store (`Schemas#mergeTwinCards`): `{at, date, day, merged, skipped}`. Its presence is the once. */
export const TWINS_MERGED_KEY = "schemas.twins.merged";
/** One merged twin: `schemas.twin.<gone>` → `{keep, name, day, at}`, and `undone` once the owner put it back. `store/owner-op-seam.ts` spells the prefix too. */
export const TWIN_PREFIX = "schemas.twin.";

/**
 * A tallied name's kind, from what its memories are ABOUT: the person, place
 * or entity memories that carry the name in their title. A person when those
 * say person at least as often as anything else, then a place, else an entity —
 * a name only ever mentioned in passing is a thing until a memory is about it.
 * A skill is never inferred from a name. The kind is fixed at birth
 * (types.ts), and for now it decides little beyond how slowly the card fades.
 * A TIE WITH ENTITY IS AN ENTITY (2026-10-22): one place memory beside one
 * entity memory made "Counterparts" a place. It is not the card's kind of
 * subject either (`store/operational.ts#deterministicSubjectKind`): the
 * night's kinds ask sorts that, shown this kind as a hint.
 */
function kindForName(n: NameCount): BirthKind {
  const person = n.titledKinds["person"] ?? 0;
  const place = n.titledKinds["place"] ?? 0;
  const entity = n.titledKinds["entity"] ?? 0;
  if (person > 0 && person >= place && person > entity) return "person";
  if (place > 0 && place > entity) return "place";
  return "entity";
}

interface MetaRecord {
  role: SchemaRole;
  /** entity rows only */
  name?: string;
  aliases?: string[];
  /** belief / current-state rows only */
  entityId?: string;
  statedOn?: string;
  statedOnDay?: number;
}

export interface SchemasOptions {
  store: Store;
  /** Telemetry sink. The ring is in memory only — see INTERFACE-GAPS §1. */
  onEvent?: (event: SchemaEvent) => void;
  /**
   * SEAMS item E — the supersede executor's edge callback, INJECTED because this
   * module must not import `associate/` (and `store.supersede` must not depend on
   * a core module above it). Wired to `Associate.retargetOnSupersede` at the
   * composition root; absent, the successor starts cold, which is scar §2.2
   * itself: *v1's `gist.merge` set `merged_into` and nothing re-pointed the
   * edges.* It is called in the SAME FLOW as the supersede, immediately after the
   * new id exists, so an arc cannot be half-moved by a caller that forgets.
   */
  retarget?: (oldId: string, newId: string, day: number) => void;
}

const ZERO_DIMS: DimensionsInput = { relevance: 0, emotional: 0, predictive: 0 };

/** The memory sources that are not lived: a dream's words, a reflection's own entry (reflect.ts `notLivedReason`). */
const NOT_LIVED_SOURCES: ReadonlySet<string> = new Set(["dreamed", "reflection"]);

export class Schemas {
  readonly store: Store;
  private readonly index = new AliasIndex();
  /** Cards the fade archived, by their handles, so a saved memory naming one can bring it back (NOTES §15). */
  private readonly faded = new AliasIndex();
  private readonly meta = new Map<string, MetaRecord>();
  private readonly byEntity = new Map<string, Set<string>>();
  private readonly birthsPerChunk = new Map<string, number>();
  private readonly increments: PressureIncrement[] = [];
  private readonly ring: SchemaEvent[] = [];
  /** What `load` left out, by whether the store could account for it. */
  private readonly skips = { removed: 0, unaccounted: [] as string[] };
  /** Every schema id `load` or `adopt` has looked at, taken or skipped. */
  private readonly walked = new Set<string>();
  private readonly onEvent: ((e: SchemaEvent) => void) | undefined;
  private readonly retarget: ((oldId: string, newId: string, day: number) => void) | undefined;

  private constructor(opts: SchemasOptions) {
    this.store = opts.store;
    this.onEvent = opts.onEvent;
    this.retarget = opts.retarget;
    this.load();
  }

  static open(opts: SchemasOptions): Schemas {
    return new Schemas(opts);
  }

  /**
   * One scan at open, because box 2 indexes type/kind/band/archived and has no
   * meta query (INTERFACE-GAPS §2). Prose comes through `readProseWalking`
   * rather than `Store.read`, so building an index does not spend the store's
   * archived-read telemetry — that event answers "did anyone look at archived
   * CONTENT", and an index build is not a look.
   *
   * **A REMOVED ROW IS SKIPPED, and that is what keeps the session alive.** The
   * deny-list is fetched once here rather than asked per id: this runs at every
   * open, over every schema row, and a removal must cost the index one query,
   * not one per row.
   *
   * **The two skips are counted apart, because only one of them is explained.**
   * A row the deny-list names was removed by the owner and its absence is the
   * point. A TOMBSTONED row with no removal record is something else — a
   * half-written repair, a disk event — and skipping it buys uptime with data
   * disappearing without a word. Both are skipped (a session that
   * cannot start helps nobody), and `loadSkips()` says which was which, so the
   * difference is a fact rather than a silence. Nothing prints it yet.
   */
  private load(): void {
    const denied = new Set(this.store.deniedIds());
    for (const id of this.store.list({ type: "schema" })) {
      this.walked.add(id);
      const row = this.store.row(id);
      if (row === undefined) continue;
      if (denied.has(id)) {
        this.skips.removed += 1;
        continue;
      }
      if (rowTombstoned(row)) {
        this.skips.unaccounted.push(id);
        continue;
      }
      this.take(id, row);
    }
  }

  /**
   * ONE ROW ANOTHER PROCESS WROTE SINCE THIS INDEX WAS BUILT (review of #583):
   * a long-lived server opened before a belief or a card was born elsewhere
   * read its index once, at open, and would not know it — a correction
   * would find "no belief" and a duplicate would pass. Learned on a miss, as
   * `load` would have read it — its meta only: the alias index (which names
   * link a memory to a card) stays as this process built it, for now, so a
   * name another process gave a card does not start linking mid-run. False
   * when it is not an element or a card.
   */
  private learn(id: string): boolean {
    if (this.notElements.has(id)) return false;
    const row = this.store.row(id);
    if (row === undefined) return false;
    // A memory never becomes a schema row: asked once (an update's target), not read again.
    if (row.type !== "schema") {
      this.notElements.add(id);
      return false;
    }
    if (rowTombstoned(row) || this.store.deniedIds().includes(id)) return false;
    let rec: MetaRecord | null;
    try {
      rec = toMetaRecord(readProseWalking(this.store, id, row).meta);
    } catch {
      return false;
    }
    if (rec === null) {
      this.notElements.add(id);
      return false;
    }
    this.remember(id, rec);
    return true;
  }

  /** Every BELIEF this index has not seen yet (`learn` each): a subject's beliefs read whole, across processes. */
  private catchUp(): void {
    for (const id of this.store.list({ type: "schema" })) {
      if (this.meta.has(id) || this.notElements.has(id) || this.notBeliefs.has(id)) continue;
      const row = this.store.row(id);
      if (row === undefined || row.birth_route === null || row.birth_route === undefined) this.notBeliefs.add(id);
      else this.learn(id);
    }
  }

  /** Schema rows that are not elements or cards (the page, a handoff): not read again. */
  private readonly notElements = new Set<string>();
  /** Schema rows `catchUp` passed as not beliefs (a card another process made, the identity core). */
  private readonly notBeliefs = new Set<string>();

  /** One schema row into the index, as `load` reads it. */
  private take(id: string, row: MemoryRow): void {
    const doc = readProseWalking(this.store, id, row);
    const rec = toMetaRecord(doc.meta);
    if (rec === null) return;
    this.remember(id, rec);
    if (rec.role === "entity" && row.archived === 0) {
      this.index.register(id, rec.name ?? "", rec.aliases ?? []);
    } else if (rec.role === "entity" && row.archived_reason === TUNABLES.FADE_REASON) {
      this.faded.register(id, rec.name ?? "", rec.aliases ?? []);
    }
  }

  /**
   * THE ROWS ANOTHER PROCESS WROTE SINCE `load` (2026-10-21, the card twins).
   * `load` reads the store once, at open, so a card born since in another
   * process is a row this index has never seen, and the name it holds reads as
   * free here. That is how one name got two cards (NOTES, "Card twins"): two
   * workers ran the births phase at once, each against its own index.
   *
   * Two passes. The rows neither `load` nor an earlier call has walked (ids
   * this process minted are already in `meta`), taken the way `load` takes
   * them, removed and blanked rows skipped (not counted: `loadSkips` is what
   * the OPEN left out). Then the live cards still missing from the index — one
   * archived when `load` read it and brought back by another process since
   * (review of #578) — registered as live. Returns the ids it put in the index.
   */
  private adopt(): string[] {
    const added: string[] = [];
    let denied: Set<string> | undefined;
    const unwalked = this.store.list({ type: "schema" }).filter((id) => !this.walked.has(id) && !this.meta.has(id));
    for (const id of unwalked) {
      this.walked.add(id);
      const row = this.store.row(id);
      if (row === undefined || rowTombstoned(row)) continue;
      if ((denied ??= new Set(this.store.deniedIds())).has(id)) continue;
      this.take(id, row);
      if (this.index.has(id)) added.push(id);
    }
    for (const { id, rec } of this.unseenCards()) {
      this.remember(id, rec);
      this.faded.unregister(id);
      this.index.register(id, rec.name ?? "", rec.aliases ?? []);
      added.push(id);
    }
    return added;
  }

  /**
   * THE LIVE CARDS THIS INDEX DOES NOT HOLD: live schema rows not in the index,
   * less the ones it knows are not cards. A row it has never read is read here
   * (and not remembered: this is a read, asked inside a write transaction);
   * removed and blanked rows are skipped.
   */
  private unseenCards(): { id: string; rec: MetaRecord }[] {
    const out: { id: string; rec: MetaRecord }[] = [];
    let denied: Set<string> | undefined;
    for (const id of this.store.list({ type: "schema", archived: false })) {
      if (this.index.has(id)) continue;
      const known = this.meta.get(id);
      if (known !== undefined && known.role !== "entity") continue;
      // Walked and still unknown: `load` skipped it, or it carries no record.
      if (known === undefined && this.walked.has(id)) continue;
      const row = this.store.row(id);
      if (row === undefined || row.archived !== 0 || rowTombstoned(row)) continue;
      if ((denied ??= new Set(this.store.deniedIds())).has(id)) continue;
      const rec = known ?? toMetaRecord(readProseWalking(this.store, id, row).meta);
      if (rec === null || rec.role !== "entity") continue;
      out.push({ id, rec });
    }
    return out;
  }

  /**
   * A CARD BORN WITHOUT ITS LOOK-BACK (review of #578). A birth commits the
   * card, then links the memories already naming it (`linkNamingMemories`); a
   * process killed between the two leaves a card nothing links, and nothing
   * would ever link them: the tally skips the name the card holds. So before
   * the night's tally, a live card with no `birth` link at all looks back — one
   * read finds them, and this runs outside any write lock. A births card always
   * has some (its name was in at least `MIN_MEMORIES` memories). One that truly
   * names none would be scanned for again every night, a full pass over the
   * memories each time, so a card looks back ONCE: a look-back that ran (found
   * something or nothing) leaves `RELINKED_PREFIX<id>`, and a card with that row
   * is not asked again. A look-back that failed leaves none and is retried. The
   * identity core is not born here and is left alone, and so is a topic card
   * (wave 2): it has no name to look back by, and its memories are its tags.
   */
  private relinkUnlinked(day: number): number {
    const linked = new Set(this.store.subjectsLinkedVia("birth"));
    let relinked = 0;
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity" || linked.has(id) || !this.index.has(id)) continue;
      if ((rec.name ?? "").length === 0) continue;
      const row = this.store.row(id);
      if (row === undefined || row.archived !== 0 || row.kind === "self") continue;
      if (this.store.getMeta(`${RELINKED_PREFIX}${id}`) !== undefined) continue;
      const links = this.linkNamingMemories(id);
      if (links !== null) this.store.setMeta(`${RELINKED_PREFIX}${id}`, String(day));
      this.emit("schema.subjects.relinked", id, { day, links: links ?? 0, failed: links === null });
      relinked += 1;
    }
    return relinked;
  }

  /**
   * `settle`'s three name gates — an exact holder, a near collision, an alias
   * held — asked of the live cards this index does not hold (2026-10-21, the
   * card twins). Reads only, so it is safe inside the write transaction
   * `Schemas#birth` asks it in, and the index changes only when the answer is
   * yes and `birth` adopts what it found.
   */
  private heldUnseen(name: string, aliases: readonly string[]): boolean {
    const unseen = new AliasIndex();
    const terms: string[] = [];
    for (const { id, rec } of this.unseenCards()) {
      unseen.register(id, rec.name ?? "", rec.aliases ?? []);
      terms.push(rec.name ?? "", ...(rec.aliases ?? []));
    }
    return (
      unseen.lookup(name).length > 0 ||
      terms.some((t) => collision(name, t) === "near") ||
      aliases.some((alias) => unseen.lookup(alias).length > 0)
    );
  }

  private remember(id: string, rec: MetaRecord): void {
    this.meta.set(id, rec);
    if (rec.entityId !== undefined) {
      const set = this.byEntity.get(rec.entityId) ?? new Set<string>();
      set.add(id);
      this.byEntity.set(rec.entityId, set);
    }
  }

  private emit(
    event: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const e: SchemaEvent = { at: Date.now(), event };
    if (ref !== undefined) e.ref = ref;
    if (data !== undefined) e.data = data;
    this.ring.push(e);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(e);
  }

  /** Copies, oldest first, optionally filtered by name. */
  events(name?: string): SchemaEvent[] {
    return this.ring.filter((e) => name === undefined || e.event === name).map((e) => ({ ...e }));
  }

  // ── birth by mention ───────────────────────────────────────────────────────

  /**
   * A newly-named entity becomes a stub schema immediately.
   *
   * There is no approval gate and no proposal queue: v1's autonomous-birth gate
   * recorded zero births AND zero refusals across 89 interpreter runs — "a gate
   * with no knocks is unmeasured" — so what survives is only the MECHANICAL
   * grounds, which are cheap and still true. Every one of them refuses loudly
   * with its own reason, and THE PROPOSAL IS LOGGED WHATEVER HAPPENS (scar
   * §2.4): "refused" and "never proposed to" must never again be the same
   * record.
   *
   * A newborn schema asserts nothing — names and aliases only (§5 G6). Its
   * salience is zero, which is not a slight: it is what makes death-by-decay
   * the default for a name nobody says twice.
   *
   * A name whose previous entity FADED is a new birth, not a resurrection: the
   * old entity died by physics, and the mention is a fresh place for memories
   * to attach. The old id stays resolvable and keeps its exit in the lifecycle
   * counts, and the birth is tagged `schema.birth.after-fade` so churn —
   * born, faded, born again — is a countable fact rather than an argument
   * (NOTES §6).
   */
  mention(input: MentionInput): BirthOutcome {
    const name = input.name.trim();
    const nameHash = hashText(handleKey(name));
    this.emit("schema.mention", input.chunkRef, {
      nameHash,
      kind: input.kind,
      day: input.day,
      aliasesDeclared: input.aliases?.length ?? 0,
    });

    const refuse = (reason: BirthReason): BirthOutcome => this.refuseBirth(input, nameHash, reason);

    // Layer 1 of "never a second self", checked FIRST and independently of every
    // other ground: one identity core, and a second is a category error no
    // evidence could justify (§5 G5).
    if (input.kind === "self") return refuse("second-self-refused");
    if (!isBirthKind(input.kind)) return refuse("kind-not-allowed");
    if (name.length < TUNABLES.NAME_MIN_CHARS) return refuse("name-empty");
    // A credential must never become an entity the store indexes (encode's ops rule).
    if (containsSecret(name)) return refuse("name-is-secret");
    // The ONE whole-word rule, the same call preselection makes (SEAMS §7).
    if (!occursAsWholeWord(input.source, name)) return refuse("name-not-in-source");

    return this.settle(name, input.kind, input, nameHash, true);
  }

  /**
   * What a mention does once its name is admitted: the existing card, a
   * refusal, or a birth. Shared by the title path and a body mention of a
   * faded card, so both bring a card back the same way. A revival skips the
   * per-chunk cap — it brings back a card that existed rather than inventing one.
   */
  private settle(
    name: string,
    kind: BirthKind,
    input: MentionInput,
    nameHash: string,
    capped: boolean,
  ): BirthOutcome {
    const exact = this.liveHolders(name);
    if (exact.length > 1) return this.refuseBirth(input, nameHash, "ambiguous-existing-name", exact);
    const hit = exact[0];
    if (hit !== undefined) {
      const row = this.store.row(hit);
      // Layer 2: a name that resolves to the identity core is not a birth site,
      // whatever kind the mention claimed.
      if (row?.kind === "self") return this.refuseBirth(input, nameHash, "second-self-refused", [hit]);
      if (row !== undefined && row.kind !== kind) {
        return this.refuseBirth(input, nameHash, "collision-exact-different-kind", [hit]);
      }
      return this.reMention(hit, input, nameHash);
    }

    const near = this.nearCollisions(name);
    if (near.length > 0) return this.refuseBirth(input, nameHash, "collision-near", near);

    const used = this.birthsPerChunk.get(input.chunkRef) ?? 0;
    if (capped && used >= TUNABLES.MAX_BIRTHS_PER_CHUNK) {
      return this.refuseBirth(input, nameHash, "birth-cap-per-chunk");
    }

    return this.birth(name, kind, input, nameHash);
  }

  private refuseBirth(
    input: MentionInput,
    nameHash: string,
    reason: BirthReason,
    collidedWith: string[] = [],
  ): BirthOutcome {
    this.emit("schema.birth.refused", input.chunkRef, {
      nameHash,
      kind: input.kind,
      reason,
      collided: collidedWith.length,
    });
    return {
      ok: false,
      reason,
      id: null,
      born: false,
      collidedWith,
      droppedAliases: [],
      keptAliases: [],
      reinforced: false,
    };
  }

  /**
   * The live cards a handle resolves to. More than one is an ambiguous handle,
   * and both callers credit none of them.
   */
  private liveHolders(term: string): string[] {
    return this.index
      .lookup(term)
      .filter((id) => this.meta.get(id)?.role === "entity" && !this.fadedElsewhere(id));
  }

  /**
   * A saved memory that names a card in its title or body counts as that card
   * being used (NOTES §15). A live card is credited; a card the fade archived
   * comes back the way a title mention brings it back — a fresh birth tagged
   * `schema.birth.after-fade` — carrying its old name and aliases. Nothing that
   * never existed is born, and a card pruned or removed stays gone. A handle
   * held by two cards, live or faded, credits and revives neither; the identity
   * core is left alone. Physics' once-per-lived-day rule applies as for any use.
   */
  creditNamedIn(input: NamedInTextInput): NamedInTextReport {
    const report: NamedInTextReport = { credited: [], refused: [], revived: [], ambiguous: 0 };
    if (input.text.trim().length === 0) return report;
    const except = new Set(input.except ?? []);
    // Live terms first: a card faded by another process moves to `faded` on its
    // first lookup, so the faded pass below can see it.
    const terms = new Map<string, string>();
    for (const hit of this.index.matchesIn(input.text)) {
      this.liveHolders(hit.term);
      terms.set(handleKey(hit.term), hit.term);
    }
    for (const hit of this.faded.matchesIn(input.text)) terms.set(handleKey(hit.term), hit.term);

    const named = new Set<string>();
    const fading = new Set<string>();
    let denied: Set<string> | undefined;
    const removedIds = (): Set<string> => (denied ??= new Set(this.store.deniedIds()));
    for (const [key, term] of terms) {
      if (key.length < TUNABLES.NAME_MIN_CHARS) continue;
      const live = this.liveHolders(term);
      const faded = this.fadedHolders(term, removedIds);
      if (live.length + faded.length > 1) {
        report.ambiguous += 1;
        continue;
      }
      if (live[0] !== undefined) named.add(live[0]);
      if (faded[0] !== undefined) fading.add(faded[0]);
    }

    for (const id of [...named].sort()) {
      if (except.has(id) || this.store.row(id)?.kind === "self") continue;
      const credit = this.store.reinforce(id, input.day, TUNABLES.MENTION_TIER);
      (credit.credited ? report.credited : report.refused).push(id);
      this.emit("schema.mention.named", id, {
        day: input.day,
        ref: input.ref,
        credited: credit.credited,
        creditReason: credit.reason,
      });
    }
    for (const priorId of [...fading].sort()) {
      const out = this.revive(priorId, input);
      if (out === null) continue;
      if (out.born) report.revived.push(out.id as string);
      else if (out.reason === "existing") (out.reinforced ? report.credited : report.refused).push(out.id as string);
    }
    return report;
  }

  /**
   * The faded cards a handle names, one per name. A faded card whose name a
   * live card now holds is that card's past life, not a second holder. Of
   * several faded cards with one name, the latest-born speaks for them.
   */
  private fadedHolders(term: string, removedIds: () => Set<string>): string[] {
    const ids = this.faded.lookup(term);
    if (ids.length === 0) return [];
    const denied = removedIds();
    const byName = new Map<string, { id: string; birth: number }>();
    for (const id of ids) {
      const rec = this.meta.get(id);
      const row = this.store.row(id);
      if (rec === undefined || row === undefined || row.archived !== 1 || this.removed(id, row, denied)) {
        this.faded.unregister(id);
        continue;
      }
      const key = handleKey(rec.name ?? "");
      if (this.liveHolders(rec.name ?? "").some((l) => handleKey(this.meta.get(l)?.name ?? "") === key)) continue;
      const prev = byName.get(key);
      if (prev === undefined || row.birth_day > prev.birth || (row.birth_day === prev.birth && id > prev.id)) {
        byName.set(key, { id, birth: row.birth_day });
      }
    }
    return [...byName.values()].map((v) => v.id).sort();
  }

  /**
   * Bring a faded card back through the title path's own birth. Its old aliases
   * come along: they passed the gate when declared, so the old card's handles
   * are the source they are checked against here.
   */
  private revive(priorId: string, input: NamedInTextInput): BirthOutcome | null {
    const rec = this.meta.get(priorId);
    const kind = this.store.row(priorId)?.kind;
    if (rec === undefined || kind === undefined || !isBirthKind(kind)) return null;
    const name = rec.name ?? "";
    const aliases = rec.aliases ?? [];
    const out = this.settle(
      name,
      kind,
      { name, kind, source: [name, ...aliases].join("\n"), chunkRef: input.ref, aliases, day: input.day },
      hashText(handleKey(name)),
      false,
    );
    this.emit("schema.mention.revived", out.id ?? priorId, {
      day: input.day,
      ref: input.ref,
      priorId,
      reason: out.reason,
    });
    return out;
  }

  /** An entity archived by the fade (not pruned) that held this exact name, if any. */
  private fadedNamed(name: string, except: string): string | undefined {
    const key = handleKey(name);
    for (const [id, rec] of this.meta) {
      if (id === except || rec.role !== "entity") continue;
      if (handleKey(rec.name ?? "") !== key) continue;
      const row = this.store.row(id);
      if (row?.archived === 1 && row.archived_reason === TUNABLES.FADE_REASON) return id;
    }
    return undefined;
  }

  /**
   * An indexed card whose row is archived — faded (or pruned) by a sleep cycle
   * in ANOTHER process, which this long-lived index could not hear about. It is
   * dropped from the index here, so a mention of the name is a fresh birth
   * rather than a reinforcement of a card nothing surfaces (NOTES §14).
   */
  private fadedElsewhere(id: string): boolean {
    const row = this.store.row(id);
    if (row?.archived !== 1) return false;
    this.index.unregister(id);
    const rec = this.meta.get(id);
    if (rec !== undefined && row.archived_reason === TUNABLES.FADE_REASON) {
      this.faded.register(id, rec.name ?? "", rec.aliases ?? []);
    }
    return true;
  }

  private nearCollisions(name: string): string[] {
    const out: string[] = [];
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity") continue;
      if (!this.index.has(id)) continue;
      const terms = [rec.name ?? "", ...(rec.aliases ?? [])];
      if (terms.some((t) => collision(name, t) === "near") && !this.fadedElsewhere(id)) out.push(id);
    }
    return out.sort();
  }

  /**
   * The same name, twice: ONE entity. Dedup does not consume the chunk's birth
   * budget — the budget guards against a confused chunk inventing five things,
   * not against a span saying one thing twice.
   *
   * A re-mention REINFORCES at the `referenced` tier: a mention is the entity
   * being used, and physics refuses the credit on the birth day and again on any
   * day already credited, so "accumulates" means distinct lived days by
   * construction (NOTES §4).
   */
  private reMention(id: string, input: MentionInput, nameHash: string): BirthOutcome {
    const credit = this.store.reinforce(id, input.day, TUNABLES.MENTION_TIER);
    this.emit("schema.mention.existing", id, {
      nameHash,
      day: input.day,
      credited: credit.credited,
      creditReason: credit.reason,
    });
    return {
      ok: true,
      reason: "existing",
      id,
      born: false,
      collidedWith: [],
      droppedAliases: [],
      keptAliases: this.index.termsFor(id)?.aliases ?? [],
      reinforced: credit.credited,
    };
  }

  private birth(
    name: string,
    kind: BirthKind,
    input: MentionInput,
    nameHash: string,
  ): BirthOutcome {
    const gated = gateAliases(input.aliases, input.source);
    const dropped = gated.dropped.map((d) => ({ index: d.index, reason: d.reason as string }));
    const kept: string[] = [];
    keptIndices(input.aliases, gated.dropped).forEach((declaredIndex, i) => {
      const alias = gated.kept[i];
      if (alias === undefined) return;
      // A key pointing at two things retrieves neither well: an alias already
      // resolving elsewhere is DROPPED, never fatal (§14.3). Reported by the
      // index it was DECLARED at, like every other drop.
      if (this.index.lookup(alias).length > 0) {
        dropped.push({ index: declaredIndex, reason: "alias-resolves-elsewhere" });
        return;
      }
      kept.push(alias);
    });
    for (const d of dropped) {
      this.emit("schema.alias.dropped", input.chunkRef, { index: d.index, reason: d.reason });
    }

    const seam = clampSalienceAtSeam({ novelty: null, ...ZERO_DIMS }, null);
    // ASKED AGAIN UNDER THE WRITE LOCK (2026-10-21, the card twins). Everything
    // above judged this index, read at open; another process may have given the
    // name a card since. The same gates `settle` applied are asked of the cards
    // this index has not seen, inside the transaction that would write this
    // one, so of two processes minting one name, the second sees the first's.
    const id = this.store.putUnless(
      {
        type: "schema",
        kind,
        title: name,
        body: stubBody(name, kept, input.day),
        meta: { role: "entity", name, aliases: kept },
        salience: seam.salience,
        physics: { birthDay: input.day, lastUsedDay: input.day },
      },
      () => this.heldUnseen(name, kept),
    );
    if (id === null) {
      // Taken in, and judged again against the index as it now stands: the
      // other card, a collision, or a birth without the aliases it took. That
      // second birth asks again too; only a card born meanwhile can refuse it,
      // since what was found is in the index now. The per-chunk cap was
      // already passed, and nothing was spent from it.
      this.adopt();
      this.emit("schema.birth.raced", input.chunkRef, { nameHash, kind, day: input.day });
      return this.settle(name, kind, input, nameHash, false);
    }
    this.remember(id, { role: "entity", name, aliases: kept });
    this.index.register(id, name, kept);
    this.birthsPerChunk.set(input.chunkRef, (this.birthsPerChunk.get(input.chunkRef) ?? 0) + 1);
    // v12: A NEW CARD LOOKS BACK — the memories already written that name it
    // are linked to it now, as a memory written after it would be at its write.
    this.linkNamingMemories(id);
    const priorlyFaded = this.fadedNamed(name, id);
    if (priorlyFaded !== undefined) {
      this.emit("schema.birth.after-fade", id, { nameHash, priorId: priorlyFaded, day: input.day });
    }
    this.emit("schema.birth", id, {
      nameHash,
      kind,
      day: input.day,
      aliases: kept.length,
      aliasesDropped: dropped.length,
      chunkRef: input.chunkRef,
    });
    return {
      ok: true,
      reason: "born",
      id,
      born: true,
      collidedWith: [],
      droppedAliases: dropped,
      keptAliases: kept,
      reinforced: false,
    };
  }

  /**
   * The explicit alias operation (§4.2 G4). Aliases change HERE and nowhere
   * else — never as a side effect of editing prose, which is why there is no
   * path that re-reads names out of a body.
   */
  addAliases(
    id: string,
    aliases: readonly string[],
    source: string,
    day: number,
  ): { ok: boolean; reason: string; kept: string[]; dropped: { index: number; reason: string }[] } {
    const rec = this.meta.get(id);
    if (rec === undefined || rec.role !== "entity") {
      this.emit("schema.alias.refused", id, { reason: "entity-unknown" });
      return { ok: false, reason: "entity-unknown", kept: [], dropped: [] };
    }
    const gated = gateAliases(aliases, source);
    const dropped = gated.dropped.map((d) => ({ index: d.index, reason: d.reason as string }));
    const existing = rec.aliases ?? [];
    const kept = [...existing];
    keptIndices(aliases, gated.dropped).forEach((declaredIndex, i) => {
      const alias = gated.kept[i];
      if (alias === undefined) return;
      if (this.index.lookup(alias).filter((o) => o !== id).length > 0) {
        dropped.push({ index: declaredIndex, reason: "alias-resolves-elsewhere" });
        return;
      }
      if (!kept.some((k) => handleKey(k) === handleKey(alias))) kept.push(alias);
    });
    const next: MetaRecord = { role: "entity", name: rec.name ?? "", aliases: kept };
    this.store.revise(id, { meta: { role: "entity", name: next.name, aliases: kept }, reason: "alias-op" });
    this.meta.set(id, next);
    this.index.register(id, next.name ?? "", kept);
    for (const d of dropped) {
      this.emit("schema.alias.dropped", id, { index: d.index, reason: d.reason });
    }
    this.emit("schema.alias.registered", id, { kept: kept.length, dropped: dropped.length, day });
    return { ok: true, reason: "registered", kept, dropped };
  }

  // ── beliefs and current state ──────────────────────────────────────────────

  /**
   * THE SUBJECT THAT IS ME (store v14, 2026-10-21; for lane C): the one card
   * my beliefs about myself and about us attach to, made, found, or revived
   * by `Store#ensureSelfSubject` (its comment has the shape and why its kind is
   * `fact`), and registered here so `addBelief` finds it with no
   * `entity-unknown` refusal. It has no name, so the alias index gains no
   * handle from it. Nothing calls this yet.
   */
  ensureSelfSubject(): string {
    const id = this.store.ensureSelfSubject();
    const row = this.store.row(id);
    if (row !== undefined) {
      const rec = toMetaRecord(readProseWalking(this.store, id, row).meta);
      if (rec !== null) {
        this.remember(id, rec);
        this.faded.unregister(id);
        this.index.register(id, rec.name ?? "", rec.aliases ?? []);
      }
    }
    return id;
  }

  /**
   * Mint a belief on an entity. The row's kind is the ENTITY's kind, which is
   * how "revision bars differ by kind" becomes arithmetic rather than policy:
   * a belief about a person inherits iota 0.8, project state on an entity 0.5 —
   * the loosening chosen out loud (§4.3).
   */
  addBelief(input: BeliefInput): BeliefOutcome {
    const entity = this.requireEntity(input.entityId);
    if (entity.problem !== null) {
      this.emit("schema.belief.refused", input.entityId, { reason: entity.problem });
      return { ok: false, reason: entity.problem, id: null };
    }
    const statement = input.statement.trim();
    if (statement.length === 0) {
      this.emit("schema.belief.refused", input.entityId, { reason: "statement-empty" });
      return { ok: false, reason: "statement-empty", id: null };
    }
    // BORN WEAK (wave 2 lane C, 2026-10-21; physics §5.13): every belief
    // starts provisional, whoever writes it — its dimensions and its claim at
    // most `BELIEF_BIRTH_CEILING` (the seam's ceiling, so a cut is recorded as
    // one), no feeling of its own (its support carries feeling), the ceiling
    // itself when nothing was said, and a birth route, which is what makes it
    // a belief to physics. What lifts it after is support, counted once per
    // memory (`fileSupport`). A MIGRATED belief is not born here: it keeps the
    // strength it lived in v1 (owner ruling 2026-08-29), for now.
    // MIGRATED IS ONE FACT, READ OFF THE ROUTE (review of #575): physics reads
    // the row's birth route alone, so the channel must agree with it.
    const migrated = input.birthRoute === "migrated";
    if (migrated !== (input.channel === "migrated")) {
      this.emit("schema.belief.refused", input.entityId, { reason: "route-channel-mismatch" });
      return { ok: false, reason: "route-channel-mismatch", id: null };
    }
    const ceiling = PHYSICS_TUNABLES.BELIEF_BIRTH_CEILING;
    const dims = input.dimensions;
    const put = this.mintElement({
      role: "belief",
      entityId: input.entityId,
      kind: entity.row.kind,
      body: statement,
      day: input.day,
      ...(migrated
        ? { dimensions: dims, claimedSalience: input.claimedSalience ?? null }
        : {
            dimensions:
              dims === undefined
                ? undefined
                : { relevance: Math.min(ceiling, dims.relevance), emotional: 0, predictive: Math.min(ceiling, dims.predictive) },
            claimedSalience: input.claimedSalience ?? (dims === undefined ? ceiling : null),
            ceiling,
          }),
      ...(input.channel === undefined ? {} : { channel: input.channel }),
      protectedFlag: input.protected === true,
      meta: { groundedIn: [...(input.groundedIn ?? [])], ...(input.fromCandidate === undefined ? {} : { fromCandidate: input.fromCandidate }) },
      birthRoute: input.birthRoute,
      ...(input.about === undefined ? {} : { about: input.about }),
    });
    this.emit("schema.belief.added", put, {
      entityId: input.entityId,
      kind: entity.row.kind,
      day: input.day,
      protected: input.protected === true,
      route: input.birthRoute,
    });
    return { ok: true, reason: "added", id: put };
  }

  /**
   * COUNTS A MEMORY FOR OR AGAINST A BELIEF, ONCE (wave 2 lane C, 2026-10-21;
   * physics §5.13). Support is how a belief is earned: lived memories that
   * fit, each counted once per belief (the table's key — filing it again is
   * `already-counted` and adds nothing), weighed by route, by spread (a day,
   * session or folder the belief already has counts less) and by feeling. The
   * store recounts the belief in the same transaction.
   *
   * What may be filed, for now: a LIVED memory (a memory or a chapter; not a
   * dream's words or a reflection's own entry), or, by `link`, another live
   * belief strong enough to lend. Never the belief itself, and never a
   * showing, a recall or a rating of it — those are not memories and not
   * routes (lane E: a rating of the belief's slot is a use credit, not
   * support). `testimony` and `choice` are read off the memory's `said_by`.
   *
   * A CONTRARY filing is counted the same way and then presses the belief
   * through the pressure arithmetic (`challengeBelief`, §5.6) at its weight:
   * REVISE when P > iota x strength, as any challenge.
   */
  fileSupport(input: SupportFilingInput): SupportFileOutcome {
    const refuse = (reason: SupportFileReason, beliefId: string | null): SupportFileOutcome => {
      this.emit("schema.support.refused", beliefId ?? input.beliefId, { reason, memoryId: input.memoryId, day: input.day });
      return { ok: false, reason, beliefId, route: null, weight: 0 };
    };
    let beliefId: string;
    try {
      beliefId = this.store.resolve(input.beliefId);
    } catch {
      return refuse("belief-unknown", null);
    }
    if (!this.meta.has(beliefId)) this.learn(beliefId);
    const rec = this.meta.get(beliefId);
    const belief = this.store.row(beliefId);
    if (rec === undefined || rec.role !== "belief" || belief === undefined) return refuse("belief-unknown", beliefId);
    if (belief.archived === 1) return refuse("belief-archived", beliefId);
    if (input.memoryId === beliefId || input.memoryId === input.beliefId) return refuse("memory-is-the-belief", beliefId);
    if (input.stance !== "support" && input.stance !== "contrary") return refuse("stance-unknown", beliefId);
    const memory = this.store.row(input.memoryId);
    if (memory === undefined || this.removed(input.memoryId, memory)) return refuse("memory-unknown", beliefId);

    const asked = input.route ?? "found";
    if (!(SUPPORT_ROUTES as readonly string[]).includes(asked)) return refuse("route-unknown", beliefId);
    let route = asked as SupportRoute;
    let note: string | undefined;
    if (route === "link") {
      if (!this.meta.has(input.memoryId)) this.learn(input.memoryId);
      const other = this.meta.get(input.memoryId);
      if (other === undefined || other.role !== "belief" || memory.archived === 1 || memory.superseded_by !== null) {
        return refuse("link-not-a-belief", beliefId);
      }
      if (strengthOf(this.store.physicsOf(input.memoryId), input.day) < PHYSICS_TUNABLES.SUPPORT_LINK_FLOOR) {
        return refuse("link-too-weak", beliefId);
      }
    } else {
      if ((memory.type !== "memory" && memory.type !== "episode") || NOT_LIVED_SOURCES.has(memory.source ?? "")) {
        return refuse("not-lived", beliefId);
      }
      // Testimony and choice are what the memory says it is, never a claim.
      const read: SupportRoute | null = memory.said_by === "owner" ? "testimony" : memory.said_by === "self" ? "choice" : null;
      if (read !== null && read !== route) {
        if (route !== "found") note = `filed as ${read}: the memory was said by ${memory.said_by === "owner" ? "the owner" : "me"}`;
        route = read;
      } else if (read === null && (route === "testimony" || route === "choice")) {
        note = `filed as found: ${route} is read off the memory's said_by, and it has none`;
        route = "found";
      }
      if (route === "use" && this.aboutMe(belief, rec)) return refuse("use-not-about-me", beliefId);
    }

    const filed = this.store.fileSupport({
      beliefId,
      memoryId: input.memoryId,
      stance: input.stance,
      route,
      day: input.day,
      weight: supportRouteWeight(route),
    });
    if (!filed) {
      this.emit("schema.support.counted-before", beliefId, { memoryId: input.memoryId, day: input.day });
      return { ok: false, reason: "already-counted", beliefId, route: null, weight: 0 };
    }
    const weight = this.store.supportOf(beliefId).find((r) => r.memoryId === input.memoryId)?.weight ?? 0;
    this.emit("schema.support.filed", beliefId, { memoryId: input.memoryId, stance: input.stance, route, weight, day: input.day });
    const out: SupportFileOutcome = { ok: true, reason: "filed", beliefId, route, weight, ...(note === undefined ? {} : { note }) };
    if (input.stance === "contrary") {
      return { ...out, revision: this.challengeBelief({ updates: beliefId, challengerId: input.memoryId, day: input.day, weight }) };
    }
    return out;
  }

  /**
   * IS THIS A BELIEF ABOUT ME OR US? (wave 2 lane E, 2026-10-22): the check
   * the beliefs slot's rating makes before it credits a use — a rating never
   * counts for one. False for an id that is not a belief. A read.
   */
  aboutMeBelief(id: string): boolean {
    if (!this.meta.has(id)) this.learn(id);
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || rec.role !== "belief" || row === undefined) return false;
    return this.aboutMe(row, rec);
  }

  /**
   * THE BELIEFS ON THE SUBJECTS A TEXT NAMES (wave 2 lane E, 2026-10-22;
   * recall's beliefs slot): the live cards its words name (`subjectsIn`, the
   * alias index's one whole-word rule) and the topics it names
   * (`tags.ts#topicsNamedIn`, a promoted tag), each subject's live beliefs as
   * they stand on `day` (`beliefStanding`), with the subject's name. Not the
   * self subject: it has no name, so no turn names it (the self is the wake's
   * page). A card that is archived or removed offers nothing. Recall picks
   * from these (floor, dedup, cap). A read; a subject that fails offers nothing.
   */
  beliefsNamedIn(text: string, day: number): { id: string; subject: string; statement: string; strength: number; support: number; contested: boolean }[] {
    if (text.trim().length === 0) return [];
    const subjects = new Set(this.subjectsIn(text));
    let topics: string[] = [];
    try {
      topics = topicsNamedIn(text, this.store.topicCards());
    } catch {
      topics = [];
    }
    for (const id of topics) subjects.add(id);
    const self = this.store.selfSubject();
    if (self !== null) subjects.delete(self);
    const out: { id: string; subject: string; statement: string; strength: number; support: number; contested: boolean }[] = [];
    for (const id of [...subjects].sort()) {
      try {
        const row = this.store.row(id);
        if (row === undefined || row.archived === 1 || this.removed(id, row)) continue;
        const standing = this.beliefStanding(id, day);
        if (standing.length === 0) continue;
        const name = this.subjectName(id, row);
        for (const b of standing) out.push({ id: b.id, subject: name, statement: b.statement, strength: b.strength, support: b.support, contested: b.contested });
      } catch {
        /* a subject that will not read offers nothing */
      }
    }
    return out;
  }

  /** A subject's name as a line says it: its name, a topic's word, or its title; "" when none. */
  private subjectName(id: string, row: MemoryRow): string {
    const rec = this.meta.get(id);
    if (rec?.name !== undefined && rec.name.trim().length > 0) return rec.name.trim();
    try {
      const meta = this.store.readProse(id).meta;
      if (typeof meta["topic"] === "string" && meta["topic"].trim().length > 0) return meta["topic"].trim();
    } catch {
      /* the title, below */
    }
    return (row.title ?? "").trim();
  }

  /**
   * A SOURCE'S TAG PARTNERS, for context priming (wave 2 lane E, 2026-10-22;
   * recall `TAGS_PRIME`): `tags.ts#tagPartners` over this store. A read.
   */
  tagPartnersOf(ids: readonly string[], opts: { readonly maxTagMemories: number; readonly neighbours: number }): Map<string, { id: string; weight: number }[]> {
    return tagPartners(this.store, ids, opts);
  }

  /** A belief about me or us — marked so, or on the self subject or the identity core — which `use` does not back. */
  private aboutMe(belief: MemoryRow, rec: MetaRecord): boolean {
    if (belief.about === "me" || belief.about === "us") return true;
    const subject = rec.entityId === undefined ? undefined : this.store.row(rec.entityId);
    return subject !== undefined && (subject.subject_kind === "self" || subject.kind === "self");
  }

  /**
   * Timestamped status about an entity — and THE PLACEMENT RULE.
   *
   * v1 measured ~72 KB of dated project status rendered verbatim into every
   * self-keyed prompt, with 14 of self's 19 active beliefs about projects that
   * had no retrieval key of their own. The corrective is not a cleanup pass; it
   * is that this seam refuses, by name, to put status in identity. Status has
   * homes — they are entities — and the refusal says so.
   */
  addCurrentState(input: CurrentStateInput): PlacementOutcome {
    const entity = this.requireEntity(input.entityId);
    if (entity.problem !== null) {
      this.emit("schema.placement.refused", input.entityId, { reason: entity.problem });
      return { ok: false, reason: entity.problem, id: null, belongsOn: null };
    }
    if (entity.row.kind === "self") {
      const reason: PlacementReason = "status-on-identity-refused";
      this.emit("schema.placement.refused", input.entityId, {
        reason,
        day: input.day,
        statementHash: hashText(input.statement),
      });
      return { ok: false, reason, id: null, belongsOn: [...BIRTH_KINDS] };
    }
    const statement = input.statement.trim();
    if (statement.length === 0) {
      this.emit("schema.placement.refused", input.entityId, { reason: "statement-empty" });
      return { ok: false, reason: "statement-empty", id: null, belongsOn: null };
    }
    // The STORE's clock, not the ambient one (§I7): a current state placed
    // during a seeded or replayed run is stated on that run's date.
    const statedOn = input.statedOn ?? this.store.today();
    const id = this.mintElement({
      role: "current-state",
      entityId: input.entityId,
      kind: entity.row.kind,
      body: statement,
      day: input.day,
      dimensions: input.dimensions,
      claimedSalience: input.claimedSalience ?? null,
      ...(input.channel === undefined ? {} : { channel: input.channel }),
      protectedFlag: false,
      happenedOn: statedOn,
      meta: { statedOn, statedOnDay: input.day },
    });
    this.emit("schema.state.placed", id, {
      entityId: input.entityId,
      kind: entity.row.kind,
      day: input.day,
      statedOn,
    });
    return { ok: true, reason: "placed", id, belongsOn: null };
  }

  private requireEntity(
    id: string,
  ): { problem: "entity-unknown" | "entity-archived" | null; row: MemoryRow } {
    if (!this.meta.has(id)) this.learn(id);
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || rec.role !== "entity" || row === undefined) {
      return { problem: "entity-unknown", row: row ?? ({} as MemoryRow) };
    }
    if (row.archived === 1) return { problem: "entity-archived", row };
    return { problem: null, row };
  }

  private mintElement(spec: {
    role: SchemaRole;
    entityId: string;
    kind: Kind;
    body: string;
    day: number;
    dimensions?: DimensionsInput;
    claimedSalience: number | null;
    /** See `BeliefInput.channel`. Default "authored"; the ceiling and the
     *  persisted `source` both derive from it — engine-set, never claimable. */
    channel?: "authored" | "fallback" | "episode" | "accommodation" | "migrated";
    protectedFlag: boolean;
    happenedOn?: string;
    meta?: Record<string, unknown>;
    salience?: Salience;
    seed?: Partial<MemoryPhysics>;
    /** A lower ceiling on the claim than the channel's (a belief born weak, lane C). */
    ceiling?: number;
    /** A belief's birth route (v14) and its about mark, written at birth. */
    birthRoute?: BirthRoute;
    about?: "me" | "us";
  }): string {
    // The CEILING derives from the channel with "authored" as the arithmetic
    // default — but the PERSISTED source is `spec.channel ?? null`: a caller
    // that says nothing records "unrecorded", never a claim of authorship. The
    // PR-2 review's blocker was exactly this conflation: a `?? "authored"`
    // persistence default stamped every migrated belief as authored-in-v2.
    const channel = spec.channel ?? "authored";
    let salience: Salience;
    if (spec.salience !== undefined) {
      salience = spec.salience;
    } else {
      // novelty is null for an engine mint and is RECORDED as null, never
      // defaulted: novelty is prediction error at encoding, and this is not one.
      //
      // The reteller's cap applies HERE TOO (owner ruling 2026-08-29): this was
      // the doctrine's latent second door — a belief placed on behalf of a
      // transcript sweep would have carried the model's uncapped claim. No live
      // caller uses the fallback channel today; when one is built, the cap is
      // already structural.
      const seam = clampSalienceAtSeam(
        { novelty: null, ...(spec.dimensions ?? ZERO_DIMS) },
        spec.claimedSalience,
        Math.min(channel === "fallback" ? PHYSICS_TUNABLES.SWEEP_CLAIM_CEILING : 1, spec.ceiling ?? 1),
      );
      if (seam.event !== null) {
        this.emit("salience.lifted", spec.entityId, {
          computed: seam.event.computed,
          claimed: seam.event.claimed,
          applied: seam.event.applied,
          ceiling: seam.event.ceiling,
          capped: seam.event.capped,
        });
      }
      salience = seam.salience;
    }
    const meta: Record<string, unknown> = {
      role: spec.role,
      entityId: spec.entityId,
      ...(spec.meta ?? {}),
    };
    const put: PutInput = {
      type: "schema",
      kind: spec.kind,
      // The statement crosses the secrets gate on its way to disk (PR-6 review
      // SF1): the direct addBelief/addCurrentState API gated the entity NAME
      // and the aliases but never the STATEMENT body — so a credential could
      // live in a belief on disk (and reach both the sweep prompt and the
      // embedder, which redact at their own edges, but the store held it raw).
      // Redacting at THE SOURCE closes all three at once, the way migrate's
      // own runGate already treats a statement.
      body: redactSecrets(spec.body),
      meta,
      salience,
      physics: {
        birthDay: spec.day,
        lastUsedDay: spec.day,
        protected: spec.protectedFlag,
        ...(spec.seed ?? {}),
      },
      ...(spec.channel === undefined ? {} : { source: spec.channel }),
      ...(spec.birthRoute === undefined ? {} : { birthRoute: spec.birthRoute }),
      // "Me" and "us" are the mark (v9) a belief about the self carries; the
      // engine sets it at birth, so it is the writer's.
      ...(spec.about === undefined ? {} : { about: spec.about, aboutBy: "writer" as const }),
    };
    if (spec.happenedOn !== undefined) put.happenedOn = spec.happenedOn;
    const id = this.store.put(put);
    const rec: MetaRecord = { role: spec.role, entityId: spec.entityId };
    if (spec.meta?.["statedOn"] !== undefined) rec.statedOn = spec.meta["statedOn"] as string;
    if (spec.meta?.["statedOnDay"] !== undefined) {
      rec.statedOnDay = spec.meta["statedOnDay"] as number;
    }
    this.remember(id, rec);
    return id;
  }

  // ── revision ───────────────────────────────────────────────────────────────

  /**
   * One declared challenge against one belief, on one lived day (§5.6).
   *
   * The declaration is RESOLVED THROUGH THE SUPERSEDE CHAIN before physics sees
   * it — `store.resolve()` is the one retarget site every write path crosses
   * (§5 G10, scar §2.2). Without it, a challenge naming a belief that was
   * revised last week comes back `target-mismatch` and the evidence is lost:
   * v1's dangling-ledger-after-supersede, rebuilt by accident.
   *
   * The pressure field lives ON THE TARGET ROW; there is no second object, so
   * the whole dangling-ledger family cannot recur. Every credited increment is
   * logged with its force, its running pressure and the bar it is climbing
   * toward — the pressure history IS the evidence record, and it is what the
   * dashboard's story view reads.
   */
  challengeBelief(input: ChallengeInput): RevisionOutcome {
    const refuse = (reason: RevisionReason, targetId: string | null): RevisionOutcome => {
      this.emit("schema.revision.refused", targetId ?? input.updates, {
        reason,
        challengerId: input.challengerId,
        day: input.day,
      });
      return {
        verdict: "hold",
        reason,
        credited: false,
        targetId,
        retargeted: false,
        successorId: null,
        force: 0,
        pressureBefore: 0,
        pressureAfter: 0,
        bar: 0,
        increment: null,
      };
    };

    if (input.updates.trim().length === 0) return refuse("no-declared-target", null);

    let targetId: string;
    try {
      targetId = this.store.resolve(input.updates);
    } catch {
      return refuse("target-unresolvable", null);
    }
    const retargeted = targetId !== input.updates;
    if (retargeted) {
      this.emit("schema.revision.retargeted", targetId, {
        declared: input.updates,
        day: input.day,
      });
    }

    if (!this.meta.has(targetId)) this.learn(targetId);
    const rec = this.meta.get(targetId);
    if (rec === undefined || rec.role !== "belief") return refuse("target-not-a-belief", targetId);
    const row = this.store.row(targetId);
    if (row === undefined) return refuse("target-unresolvable", targetId);
    // Superseded targets already resolved away above, so an archived row here is
    // archived on purpose — a distinct fact from "not a belief".
    if (row.archived === 1) return refuse("target-archived", targetId);

    const target = this.store.physicsOf(targetId);
    // Protected elements refuse every revision path, always (§5 G11). Checked
    // BEFORE the arithmetic, so a protected belief accrues no pressure at all:
    // permanence that quietly accumulated a case against itself would be a
    // different, worse guarantee.
    if (target.protected) return refuse("protected-refuses-revision", targetId);

    const challengerRow = this.store.row(input.challengerId);
    if (challengerRow === undefined) return refuse("challenger-unknown", targetId);
    const challenger = this.store.physicsOf(input.challengerId);

    // A BELIEF'S DAY IS PRESSED BY ITS STRONGEST CONTRARY MEMORY (review of
    // #575): what was credited against it today, from the durable increments,
    // so a stronger one the same day tops it up rather than being lost.
    const creditedToday = target.belief === true && target.lastChallengedDay === input.day ? this.creditedOn(targetId, input.day) : undefined;
    const outcome = applyChallenge(
      targetId,
      target,
      // The RESOLVED id is what physics is told, and the raw declaration stays in
      // the retarget event: the model proposes semantics, the engine resolves
      // references (scar §2.5).
      { id: input.challengerId, declaredUpdates: targetId, physics: challenger, ...(input.weight === undefined ? {} : { weight: input.weight }) },
      input.day,
      undefined,
      creditedToday === undefined ? {} : { creditedToday },
    );

    let increment: PressureIncrement | null = null;
    if (outcome.credited) {
      this.store.updatePhysics(targetId, outcome.next);
      const log = outcome.log;
      if (log !== null) {
        increment = {
          event: "revision.pressure",
          targetId,
          day: log.day,
          challengerId: log.challengerId,
          force: log.force,
          pressureAfter: log.pressureAfter,
          bar: log.bar,
        };
        this.increments.push(increment);
        // SEAMS item K — the increment is DURABLE, not just ringed. Restart the
        // process and the pressure number used to survive while the story of how
        // it got there did not (INTERFACE-GAPS.md §1; constitution line 16 says
        // the owner can see what changed and why). One credited challenge per
        // target per day (physics §5.6), so `(target, day, challenger)` is a
        // natural latch and a replayed day appends nothing twice.
        this.store.appendEvent({
          name: "revision.pressure",
          day: log.day,
          ref: targetId,
          dedupKey: `revision.pressure:${targetId}:${log.day}:${log.challengerId}`,
          payload: {
            targetId,
            day: log.day,
            challengerId: log.challengerId,
            force: log.force,
            pressureAfter: log.pressureAfter,
            bar: log.bar,
          },
        });
        this.emit("revision.pressure", targetId, {
          day: log.day,
          challengerId: log.challengerId,
          force: log.force,
          pressureAfter: log.pressureAfter,
          bar: log.bar,
        });
      }
    }

    let successorId: string | null = null;
    // A BELIEF BORN UNDER LANE C IS CONTESTED, NEVER REWRITTEN (2026-10-21):
    // past its bar it keeps its words — no memory's body becomes a belief —
    // takes one cut, and waits for the next reflection to revise or retire it
    // through the settle door. A migrated belief keeps the accommodation path.
    if (outcome.verdict === "revise" && target.belief === true) {
      this.contest(targetId, input, outcome.pressureAfter, outcome.bar);
      return {
        verdict: "hold",
        reason: "contested",
        credited: outcome.credited,
        targetId,
        retargeted,
        successorId: null,
        force: outcome.force,
        pressureBefore: outcome.pressureBefore,
        pressureAfter: outcome.pressureAfter,
        bar: outcome.bar,
        increment,
        contested: true,
      };
    }
    if (outcome.verdict === "revise") {
      successorId = this.supersedeBelief(targetId, rec, row, input, challenger);
    }

    return {
      verdict: outcome.verdict,
      reason: outcome.reason as RevisionReason,
      credited: outcome.credited,
      targetId,
      retargeted,
      successorId,
      force: outcome.force,
      pressureBefore: outcome.pressureBefore,
      pressureAfter: outcome.pressureAfter,
      bar: outcome.bar,
      increment,
    };
  }

  /**
   * CONTESTED (lane C, physics §5.13): the contrary pressure on a belief
   * crossed its support's resistance. Its text stands; its strength takes one
   * cut (`BELIEF_CONTESTED_FADE`, as a `changed` settle's: a multiplier, undone
   * by dividing it back out), its pressure starts again from nothing, and its
   * meta says so (`contested`: the day, the memory that carried it, the
   * pressure and the bar) for the next reflection to revise or retire it. A
   * durable `belief.contested` event keeps the story.
   */
  private contest(id: string, input: ChallengeInput, pressure: number, bar: number): void {
    // ONE CUT (review of #575): a belief already contested takes no second
    // one; later contrary memories add pressure until the reflection or the
    // owner settles it.
    let already = false;
    try {
      already = this.store.readProse(id).meta["contested"] !== undefined;
    } catch {
      already = false;
    }
    if (already) {
      this.emit("schema.belief.contested.again", id, { day: input.day, challengerId: input.challengerId, pressure, bar });
      return;
    }
    const p = this.store.physicsOf(id);
    const factor = PHYSICS_TUNABLES.BELIEF_CONTESTED_FADE;
    this.store.updatePhysics(id, { fade: fadeOf(p) * factor, pressure: 0, lastChallengedDay: input.day });
    const contested = { day: input.day, by: input.challengerId, pressure, bar, fade: factor };
    this.store.revise(id, { meta: { contested }, reason: "belief-contested" });
    this.store.appendEvent({
      name: "belief.contested",
      day: input.day,
      ref: id,
      dedupKey: `belief.contested:${id}:${String(input.day)}`,
      payload: { beliefId: id, ...contested },
    });
    this.emit("schema.belief.contested", id, { day: input.day, challengerId: input.challengerId, pressure, bar });
  }

  /** The force credited against a belief on one lived day, from its durable increments (a read). */
  private creditedOn(id: string, day: number): number {
    let total = 0;
    for (const e of this.store.eventLog({ name: "revision.pressure", ref: id })) {
      if (e.day !== day || e.payload === null) continue;
      try {
        const f = (JSON.parse(e.payload) as { force?: unknown }).force;
        if (typeof f === "number" && Number.isFinite(f)) total += f;
      } catch {
        /* a payload that will not read adds nothing */
      }
    }
    return total;
  }

  /**
   * Revision keeps its reason: the old element is retained as superseded with
   * lineage, and stays resolvable (§5 G10, earned live 2026-08-24 when
   * accommodation's forensics needed the retained element).
   *
   * The successor carries the target's `entityId` and `belief` role. Miss that
   * and the revised belief silently detaches from its schema — it stops
   * appearing in slices and in its own story, and nothing else fails.
   */
  private supersedeBelief(
    targetId: string,
    rec: MetaRecord,
    row: MemoryRow,
    input: ChallengeInput,
    challenger: MemoryPhysics,
  ): string {
    const entityId = rec.entityId ?? "";
    const successorId = this.supersedeElement({
      targetId,
      row,
      role: "belief",
      entityId,
      input,
      challenger,
      reason: TUNABLES.REVISED_REASON,
      indexRec: { role: "belief", entityId },
    });
    this.emit("schema.belief.revised", successorId, {
      predecessorId: targetId,
      entityId,
      day: input.day,
    });
    return successorId;
  }

  /**
   * A CURRENT-STATE row is a "now" fact, and the owner's ruling (2026-09-04) is
   * that a resolved `updates:` against one REPLACES it, immediately, with
   * lineage — no pressure to accumulate. That is not a second revision rule; it
   * is §4.3's own ("world-state should flip on one clear correction") applied to
   * the row type that IS world state. Pressure on a status already known stale
   * would only keep the stale line rendering into slices while the correction
   * waited for a bar it has no reason to climb.
   *
   * Everything else about the crossing is the belief path's — shared, not
   * copied: the same supersede, the same lineage, the same retarget callback,
   * the same `memory.superseded` record. The successor is stamped with a NEW
   * `statedOn`, because a replaced status is a status as of the day that
   * replaced it.
   */
  replaceCurrentState(input: ChallengeInput): ReplacementOutcome {
    const refuse = (reason: ReplacementReason, targetId: string | null): ReplacementOutcome => {
      this.emit("schema.state.replace.refused", targetId ?? undefined, {
        reason,
        challengerId: input.challengerId,
        day: input.day,
      });
      return { ok: false, reason, targetId, retargeted: false, successorId: null };
    };

    if (input.updates.trim().length === 0) return refuse("no-declared-target", null);
    let targetId: string;
    try {
      targetId = this.store.resolve(input.updates);
    } catch {
      return refuse("target-unresolvable", null);
    }
    const retargeted = targetId !== input.updates;
    if (retargeted) {
      this.emit("schema.revision.retargeted", targetId, {
        declared: input.updates,
        day: input.day,
      });
    }

    const rec = this.meta.get(targetId);
    if (rec === undefined || rec.role !== "current-state") {
      return refuse("target-not-current-state", targetId);
    }
    const row = this.store.row(targetId);
    if (row === undefined) return refuse("target-unresolvable", targetId);
    if (row.archived === 1) return refuse("target-archived", targetId);
    // Protected refuses EVERY revision path, the replace path included (§5 G11).
    if (this.store.physicsOf(targetId).protected) {
      return refuse("protected-refuses-revision", targetId);
    }
    if (this.store.row(input.challengerId) === undefined) {
      return refuse("challenger-unknown", targetId);
    }

    const challenger = this.store.physicsOf(input.challengerId);
    const entityId = rec.entityId ?? "";
    // The store's clock, not the ambient one (§I7) — same rule as the placement
    // path above, and the two must not disagree about what day it is.
    const statedOn = this.store.today();
    const successorId = this.supersedeElement({
      targetId,
      row,
      role: "current-state",
      entityId,
      input,
      challenger,
      reason: TUNABLES.REPLACED_REASON,
      meta: { statedOn, statedOnDay: input.day },
      happenedOn: statedOn,
      indexRec: { role: "current-state", entityId, statedOn, statedOnDay: input.day },
    });
    this.emit("schema.state.replaced", successorId, {
      predecessorId: targetId,
      entityId,
      day: input.day,
      statedOn,
    });
    return { ok: true, reason: "replaced", targetId, retargeted, successorId };
  }

  /**
   * The one supersede flow both element paths cross. Written once because the
   * half that is easy to forget is not the `store.supersede` call — it is
   * everything after it: the successor carries the target's `entityId` and its
   * ROLE (miss that and the revised element silently detaches from its schema —
   * it stops appearing in slices and in its own story, and nothing else fails),
   * it is registered in the in-memory index, its edges are retargeted, and the
   * crossing is recorded.
   */
  private supersedeElement(spec: {
    targetId: string;
    row: MemoryRow;
    role: SchemaRole;
    entityId: string;
    input: ChallengeInput;
    challenger: MemoryPhysics;
    reason: string;
    meta?: Record<string, unknown>;
    happenedOn?: string;
    indexRec: MetaRecord;
  }): string {
    const { targetId, input } = spec;
    const statement = (input.statement ?? this.store.readProse(input.challengerId).body).trim();
    const seed = successorSeed(this.store.physicsOf(targetId));
    const put: PutInput = {
      type: "schema",
      kind: spec.row.kind,
      body: statement,
      meta: {
        role: spec.role,
        entityId: spec.entityId,
        revisedFrom: targetId,
        groundedIn: [input.challengerId],
        ...(spec.meta ?? {}),
      },
      // The evidence that carried the revision sets the successor's salience:
      // an element is as strongly held as what made it (NOTES §3). Since lane
      // C (2026-10-21) only a MIGRATED belief reaches this path — a belief
      // born under lane C's rules is contested, never rewritten
      // (`challengeBelief`) — so its successor stays migrated (the store
      // carries no route to a successor), on the physics it lived, and its
      // predecessor's support stays where it was counted.
      salience: spec.challenger.salience,
      ...(spec.role === "belief" ? { birthRoute: "migrated" as const } : {}),
      physics: { birthDay: input.day, lastUsedDay: input.day, ...seed },
      // The channel vocabulary's fifth member finally has its writer (PR-2
      // review should-fix 1): an accommodation successor is the engine
      // revising under pressure, and its provenance is the challenger.
      source: "accommodation",
      origin: { ref: input.challengerId },
    };
    if (spec.happenedOn !== undefined) put.happenedOn = spec.happenedOn;
    const successorId = this.store.supersede(targetId, put, spec.reason);
    this.remember(successorId, spec.indexRec);
    // SEAMS item E, in the same flow as the supersede: the successor inherits the
    // old head's live edges. A retarget that THROWS must not undo a revision that
    // already landed — the element is superseded either way, and a cold successor
    // is a recoverable loss where a half-applied revision is not.
    if (this.retarget !== undefined) {
      try {
        this.retarget(targetId, successorId, input.day);
        this.emit("schema.edges.retargeted", targetId, { successorId, day: input.day });
      } catch (err) {
        this.emit("schema.edges.retarget.failed", targetId, {
          successorId,
          day: input.day,
          error: err instanceof Error ? err.name : "UNKNOWN",
        });
      }
    }
    const record = supersedeRecord(targetId, successorId, input.day);
    this.emit("memory.superseded", targetId, {
      successorId,
      day: record.day,
      resolvableUntilDay: record.resolvableUntilDay,
    });
    return successorId;
  }

  // ── death by decay ─────────────────────────────────────────────────────────

  /**
   * Would this entity fade today, and if not, why not — EVERY reason, not the
   * first (§5 G7). Death is decay: physics must say prunable, and this module
   * adds blockers of its own — an entity with live beliefs or live status is a
   * place memories are still attached to (open question 1; NOTES §5), and a card
   * fades gently: a calendar floor, and longer floors for people (NOTES §14).
   * `date` is the calendar day the floors are counted to.
   */
  fadeVerdict(id: string, day: number, date: string = this.store.today()): FadeVerdict {
    const row = this.store.row(id);
    const rec = this.meta.get(id);
    if (row === undefined || rec === undefined || rec.role !== "entity") {
      // "there is no such entity" and "it already faded" are different facts,
      // and a shared reason string would make them one (scar §2.4).
      return {
        fade: false,
        reason: "not-an-entity",
        blockedBy: ["not-an-entity"],
        strength: 0,
        band: "episodic",
        dwellDays: 0,
        attached: 0,
        livedFloorDays: 0,
        calendarDays: 0,
        calendarSource: "lived-days",
        calendarFloorDays: 0,
      };
    }
    const p = this.store.physicsOf(id);
    const floors = fadeFloors(row.kind);
    const calendar = this.calendarDaysSinceUse(id, row, p, day, date);
    if (row.archived === 1) {
      return {
        fade: false,
        reason: "already-archived",
        blockedBy: ["already-archived"],
        strength: strengthOf(p, day),
        band: bandOfPhysics(p, day),
        dwellDays: day - p.lastUsedDay,
        attached: this.liveElementIds(id).length,
        livedFloorDays: floors.lived,
        calendarDays: calendar.days,
        calendarSource: calendar.source,
        calendarFloorDays: floors.calendar,
      };
    }
    const v = pruneVerdict(p, day, { inLiveRevisionChain: false });
    const attached = this.liveElementIds(id).length;
    // `prunable` is physics' OK value and never appears among blockers; the
    // filter is there so the two vocabularies cannot silently diverge.
    const blockedBy: FadeReason[] = v.blockedBy.filter(
      (r): r is Exclude<typeof r, "prunable"> => r !== "prunable",
    );
    if (attached > 0) blockedBy.push("has-live-attached-elements");
    if (row.kind === "self") blockedBy.push("identity-core");
    // Gentle fading (NOTES §14): physics' verdict is necessary, not sufficient.
    // A kind can ask for more lived quiet, and every card needs calendar quiet.
    if (v.dwellDays >= PHYSICS_TUNABLES.D_FLOOR_DAYS && v.dwellDays < floors.lived) {
      blockedBy.push("kind-dwell-too-short");
    }
    if (calendar.days < floors.calendar) blockedBy.push("calendar-floor-not-passed");
    return {
      fade: blockedBy.length === 0,
      reason: blockedBy[0] ?? "faded",
      blockedBy,
      strength: v.strength,
      band: v.band,
      dwellDays: v.dwellDays,
      attached,
      livedFloorDays: floors.lived,
      calendarDays: calendar.days,
      calendarSource: calendar.source,
      calendarFloorDays: floors.calendar,
    };
  }

  /**
   * Calendar days since this card was last used, as a LOWER BOUND.
   *
   * The store keeps last use as a LIVED day only, so the calendar side is
   * rebuilt from three facts, each of which can only undercount:
   *   - the lived-day gap itself — every lived day is a distinct date;
   *   - the birth date (`learned_on`), when birth was the last use;
   *   - the sweep's anchor, `{ day, date }`, when the card has not been used
   *     since that lived day (an anchor older than the last use is ignored).
   * The largest wins. Undercounting only ever makes a card fade LATER.
   */
  private calendarDaysSinceUse(
    id: string,
    row: MemoryRow,
    p: MemoryPhysics,
    day: number,
    date: string,
  ): { days: number; source: FadeVerdict["calendarSource"] } {
    let best: { days: number; source: FadeVerdict["calendarSource"] } = {
      days: Math.max(0, day - p.lastUsedDay),
      source: "lived-days",
    };
    const consider = (from: string, source: FadeVerdict["calendarSource"]): void => {
      const d = calendarDaysBetween(from, date);
      if (d !== null && d > best.days) best = { days: d, source };
    };
    if (p.lastUsedDay === row.birth_day) consider(row.learned_on, "birth-date");
    const anchor = this.fadeAnchor(id);
    if (anchor !== null && anchor.day >= p.lastUsedDay) consider(anchor.date, "anchor");
    return best;
  }

  private fadeAnchor(id: string): { day: number; date: string } | null {
    const raw = this.store.getMeta(`${TUNABLES.FADE_ANCHOR_PREFIX}${id}`);
    if (raw === undefined) return null;
    try {
      const v = JSON.parse(raw) as { day?: unknown; date?: unknown };
      if (typeof v.day !== "number" || typeof v.date !== "string") return null;
      return { day: v.day, date: v.date };
    } catch {
      return null;
    }
  }

  /**
   * The sweep. Archive is a STATE, not a deletion: a faded entity keeps its id,
   * stays resolvable, and simply stops surfacing (§4.2 G3). No model, on any
   * path, holds this power — it is arithmetic on a lived day and a date.
   *
   * `sleep/` calls it on its own cadence (INTERFACE-GAPS §6). Along the way it
   * writes a calendar anchor for every live card that has none, or has been used
   * since its last one — that is how "calendar days since last use" becomes
   * knowable without a column for it (NOTES §14). A dry run writes nothing.
   */
  fadeSweep(day: number, opts: FadeSweepOptions = {}): FadeReport {
    const date = opts.date ?? this.store.today();
    const dryRun = opts.dryRun === true;
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;
    const faded: string[] = [];
    const blocked: Record<string, number> = {};
    const anchors: [string, string][] = [];
    let examined = 0;
    let skippedForLimit = 0;
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity") continue;
      const row = this.store.row(id);
      if (row === undefined || row.archived === 1) continue;
      if (examined >= limit) {
        skippedForLimit += 1;
        continue;
      }
      examined += 1;
      const v = this.fadeVerdict(id, day, date);
      if (!v.fade) {
        for (const r of v.blockedBy) blocked[r] = (blocked[r] ?? 0) + 1;
        const anchor = this.fadeAnchor(id);
        if (anchor === null || anchor.day < row.last_used_day) {
          anchors.push([`${TUNABLES.FADE_ANCHOR_PREFIX}${id}`, JSON.stringify({ day, date })]);
        }
        continue;
      }
      faded.push(id);
      if (dryRun) continue;
      this.store.archive(id, TUNABLES.FADE_REASON);
      this.index.unregister(id);
      this.faded.register(id, rec.name ?? "", rec.aliases ?? []);
      this.emit("schema.faded", id, {
        day,
        kind: row.kind,
        strength: v.strength,
        dwellDays: v.dwellDays,
        calendarDays: v.calendarDays,
        birthDay: row.birth_day,
      });
    }
    if (!dryRun && anchors.length > 0) this.store.setMetaMany(anchors);
    const anchored = dryRun ? 0 : anchors.length;
    this.emit("schema.fade.sweep", undefined, {
      day,
      examined,
      faded: faded.length,
      anchored,
      dryRun,
    });
    return { day, date, dryRun, examined, faded, blocked, anchored, skippedForLimit };
  }

  /**
   * THE TWIN CARDS, MERGED ONCE PER STORE (2026-10-22, wave 2 follow-ups).
   * Two workers' births phases ran at once until #578, and each gave a name
   * its own card (NOTES, "Card twins"): two live cards, one name, which recall
   * reads as an ambiguous handle and trains on neither. This pass finds each
   * group of live entity cards whose names are one word (case and spacing
   * aside) and, for a PAIR the two of which differ in nothing a merge could
   * lose, archives the second-born (`TWIN_REASON`) and records the card it
   * stands under (`TWIN_PREFIX` + its id), so the owner's undo
   * (`store/owner-op-seam.ts#unarchiveTwin`) is un-archiving it. Nothing
   * moves: the keeper already holds every link, alias and kind the twin had.
   *
   * Left alone and counted: three or more cards (`not-a-pair`); linked
   * memories that differ (`links-differ`); aliases that differ
   * (`aliases-differ`); a belief or current state on either
   * (`has-beliefs`); a folder on either (`has-folders`); either protected or
   * the identity core (`protected`); birth or subject kinds that differ
   * (`kinds-differ`).
   *
   * THE KEEPER LOOKS BACK (review of #593): while the twins lived, a name two
   * live cards held linked to neither (`subjectsIn`), so the memories written
   * then name the keeper and are linked to no card. Once its twin is out of
   * the index, each keeper links every memory naming it (`linkNamingMemories`'
   * rule, one pass for all keepers, `via: birth`, an existing link left as it
   * is; fail-open). The owner's undo leaves those links: they are true.
   *
   * Once per store, and FINISHED if interrupted (review of #593): the plan
   * (`TWINS_MERGED_KEY`) is written first, only if no other worker wrote one
   * (theirs is then the plan), and its presence means the pass is not planned
   * again. While a planned twin is still live and its record is not `undone`,
   * each night finishes it: archive first, then its record (`TWIN_PREFIX`), so
   * a record never names a card that is still live. `TWINS_MERGE` off: nothing
   * at all. A dry run (an observer) reports what it would do and writes nothing.
   */
  mergeTwinCards(day: number, opts: { dryRun?: boolean } = {}): TwinMergeReport {
    const dryRun = opts.dryRun === true;
    if (!TUNABLES.TWINS_MERGE) return { ran: false, dryRun, groups: 0, merged: [], skipped: {}, linked: 0 };
    const prior = this.twinPlan();
    if (prior !== null) return this.finishTwins(prior, day, dryRun, { groups: 0, skipped: {} });
    this.adopt();
    this.catchUp();
    const groups = new Map<string, { id: string; row: MemoryRow; rec: MetaRecord }[]>();
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity") continue;
      const key = (rec.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
      if (key.length === 0) continue;
      const row = this.store.row(id);
      if (row === undefined || row.archived === 1 || row.body === "" || rowTombstoned(row)) continue;
      groups.set(key, [...(groups.get(key) ?? []), { id, row, rec }]);
    }
    const merged: TwinMerge[] = [];
    const skipped: Record<string, number> = {};
    const skip = (why: string): void => {
      skipped[why] = (skipped[why] ?? 0) + 1;
    };
    let found = 0;
    for (const cards of groups.values()) {
      if (cards.length < 2) continue;
      found += 1;
      if (cards.length > 2) {
        skip("not-a-pair");
        continue;
      }
      const [keep, gone] = [...cards].sort((a, b) => (a.row.created_at ?? 0) - (b.row.created_at ?? 0) || (a.id < b.id ? -1 : 1)) as [
        (typeof cards)[number],
        (typeof cards)[number],
      ];
      const blocked = this.twinBlocker(keep.id, gone.id);
      if (blocked !== null) skip(blocked);
      else merged.push({ keep: keep.id, gone: gone.id, name: keep.rec.name ?? "" });
    }
    if (dryRun) return this.finishTwins(merged, day, true, { groups: found, skipped });
    // The plan first, and only if no other worker wrote one: an archive nobody
    // could account for is a silent loss of a card, and a second worker's
    // empty plan must not stand over the first's.
    const plan = JSON.stringify({ at: this.store.now(), date: this.store.today(), day, merged: merged.map((m) => ({ keep: m.keep, gone: m.gone, name: m.name })), skipped });
    this.store.updateMeta(TWINS_MERGED_KEY, (cur) => (cur === undefined ? plan : undefined));
    return this.finishTwins(this.twinPlan() ?? merged, day, false, { groups: found, skipped });
  }

  /** The twin pass's plan on record, or null before it ran. An unreadable record is an empty plan (it ran). */
  private twinPlan(): TwinMerge[] | null {
    const raw = this.store.getMeta(TWINS_MERGED_KEY);
    if (raw === undefined) return null;
    try {
      const rec = JSON.parse(raw) as { merged?: unknown };
      const list = Array.isArray(rec.merged) ? (rec.merged as Record<string, unknown>[]) : [];
      return list.flatMap((m) =>
        typeof m["keep"] === "string" && typeof m["gone"] === "string" && m["dropped"] === undefined ? [{ keep: m["keep"], gone: m["gone"], name: typeof m["name"] === "string" ? m["name"] : "" }] : [],
      );
    } catch {
      return [];
    }
  }

  /**
   * WHY TWO SAME-NAME CARDS MAY NOT BE MERGED, or null when they may — asked
   * by the first pass and again before every archive (delta review of #593:
   * a pair finished a night later may have drifted apart, or its keeper
   * faded). The keeper must be live; then, in order: protection or the
   * identity core, kinds, aliases, a belief or current state, a folder, and
   * the memories each is linked to (archived ones too), which must be one set.
   */
  private twinBlocker(keepId: string, goneId: string): string | null {
    const keep = this.store.row(keepId);
    const gone = this.store.row(goneId);
    if (keep === undefined || keep.archived === 1 || keep.body === "" || rowTombstoned(keep)) return "keeper-gone";
    if (gone === undefined || rowTombstoned(gone)) return "twin-gone";
    const same = (a: readonly string[], b: readonly string[]): boolean => {
      const x = [...new Set(a)].sort();
      const y = [...new Set(b)].sort();
      return x.length === y.length && x.every((v, i) => v === y[i]);
    };
    if (keep.protected === 1 || gone.protected === 1 || keep.kind === "self" || gone.kind === "self") return "protected";
    if (keep.kind !== gone.kind || (keep.subject_kind ?? null) !== (gone.subject_kind ?? null)) return "kinds-differ";
    if (!same(this.meta.get(keepId)?.aliases ?? [], this.meta.get(goneId)?.aliases ?? [])) return "aliases-differ";
    if (this.liveElementIds(keepId).length > 0 || this.liveElementIds(goneId).length > 0) return "has-beliefs";
    if (this.store.foldersOfProject(keepId).length > 0 || this.store.foldersOfProject(goneId).length > 0) return "has-folders";
    if (!same(this.store.memoriesNaming(keepId, { archived: true }), this.store.memoriesNaming(goneId, { archived: true }))) return "links-differ";
    return null;
  }

  /**
   * THE PLAN CARRIED OUT, or finished: each planned twin still live whose
   * record is not `undone` is archived, then recorded; then every keeper of a
   * twin archived under the plan looks back for the memories naming it. A
   * twin that cannot be archived (a throw) is left for the next night.
   */
  private finishTwins(plan: readonly TwinMerge[], day: number, dryRun: boolean, found: { groups: number; skipped: Record<string, number> }): TwinMergeReport {
    const undone = (gone: string): boolean => {
      try {
        return typeof (JSON.parse(this.store.getMeta(`${TWIN_PREFIX}${gone}`) ?? "{}") as Record<string, unknown>)["undone"] === "string";
      } catch {
        return false;
      }
    };
    const merged = (m: TwinMerge): boolean => this.store.row(m.gone)?.archived_reason === TUNABLES.TWIN_REASON && !undone(m.gone);
    let todo = plan.filter((m) => this.store.row(m.gone)?.archived === 0 && !undone(m.gone));
    // A twin archived by a pass a kill cut short before its record: recorded now.
    const unrecorded = plan.filter((m) => this.store.row(m.gone)?.archived_reason === TUNABLES.TWIN_REASON && this.store.getMeta(`${TWIN_PREFIX}${m.gone}`) === undefined);
    // A pass a kill cut short before its look-back (delta review of #593): the
    // record has no `linked` yet, so every keeper of a merged twin looks back.
    const lookedBack = (() => {
      try {
        const rec = JSON.parse(this.store.getMeta(TWINS_MERGED_KEY) ?? "{}") as Record<string, unknown>;
        return rec["linked"] !== undefined && rec["lookBackOwed"] !== true;
      } catch {
        return true;
      }
    })();
    const owed = !lookedBack && this.store.getMeta(TWINS_MERGED_KEY) !== undefined ? plan.filter(merged) : [];
    if (todo.length === 0 && unrecorded.length === 0 && owed.length === 0 && found.groups === 0) return { ran: false, dryRun, groups: 0, merged: [], skipped: {}, linked: 0 };
    // ASKED AGAIN BEFORE EVERY ARCHIVE (delta review of #593): the keeper must
    // still be live and the pair still one card's worth — a pair finished a
    // night later may have drifted. One that fails is dropped from the plan,
    // marked on its entry so no later night retries it, and counted.
    const dropped = new Map<string, string>();
    if (todo.length > 0) {
      this.adopt();
      this.catchUp();
      for (const m of todo) {
        const why = this.twinBlocker(m.keep, m.gone);
        if (why !== null) dropped.set(m.gone, why);
      }
      todo = todo.filter((m) => !dropped.has(m.gone));
    }
    const skipped: Record<string, number> = { ...found.skipped };
    for (const why of dropped.values()) skipped[why] = (skipped[why] ?? 0) + 1;
    if (dryRun) return { ran: true, dryRun, groups: found.groups, merged: todo, skipped, linked: 0 };
    const at = this.store.now();
    const record = (m: TwinMerge): void => this.store.setMeta(`${TWIN_PREFIX}${m.gone}`, JSON.stringify({ keep: m.keep, day, at }));
    for (const m of unrecorded) record(m);
    const done: TwinMerge[] = [];
    for (const m of todo) {
      try {
        this.store.archive(m.gone, TUNABLES.TWIN_REASON);
        record(m);
        this.index.unregister(m.gone);
        this.emit("schema.twin.merged", m.gone, { keep: m.keep, day });
        done.push(m);
      } catch {
        /* removed since, or the write failed: still planned, the next night finishes it */
      }
    }
    const keepers = [...new Set([...done, ...unrecorded, ...owed].map((m) => m.keep))];
    const look = this.linkNamingMemoriesOf(keepers);
    // What it came to, on the plan's own record (doctor's v14 line reads it):
    // how many of the planned twins stand archived, the links gained and the
    // distinct live memories they are on, and the pairs dropped since.
    try {
      const archivedNow = plan.filter(merged).length;
      this.store.updateMeta(TWINS_MERGED_KEY, (cur) => {
        if (cur === undefined) return undefined;
        const rec = JSON.parse(cur) as Record<string, unknown>;
        const num = (k: string): number => (typeof rec[k] === "number" ? (rec[k] as number) : 0);
        const was = (rec["skipped"] ?? {}) as Record<string, number>;
        for (const why of dropped.values()) was[why] = (was[why] ?? 0) + 1;
        const list = Array.isArray(rec["merged"]) ? (rec["merged"] as Record<string, unknown>[]) : [];
        return JSON.stringify({
          ...rec,
          merged: list.map((m) => (typeof m["gone"] === "string" && dropped.has(m["gone"]) ? { ...m, dropped: dropped.get(m["gone"]) } : m)),
          skipped: was,
          archived: archivedNow,
          linked: num("linked") + (look?.links ?? 0),
          linkedMemories: num("linkedMemories") + (look?.memories ?? 0),
          // A look-back that threw is owed (approval nit on #593): the next
          // night looks back for every keeper again, the counts kept.
          lookBackOwed: look === null,
        });
      });
    } catch {
      /* the counts are a courtesy; the twins' own records stand */
    }
    this.emit("schema.twins.sweep", undefined, { day, groups: found.groups, merged: done.length, linked: look?.links ?? 0, lookBackOwed: look === null, dropped: dropped.size });
    return { ran: true, dryRun, groups: found.groups, merged: done, skipped, linked: look?.links ?? 0 };
  }

  /**
   * CARDS ARE BORN WHERE NAMES ARE (2026-10-11, Group 3 part D; review 12 C1).
   * The night's half of birth by mention: the names the live memories keep
   * saying (`names.ts#tallyNames`, at least `BIRTH_TALLY.MIN_MEMORIES` memories
   * on `MIN_DAYS` lived days), most-named first, each offered to `mention()` —
   * which judges it exactly as before: the name in the source as a whole word,
   * no exact or near collision, never a second self. The source is the
   * memories that name it, so the whole-word gate stays a real gate. A newborn
   * card looks back and links every memory naming it (`linkNamingMemories`),
   * which is what makes it recall's index for that person or project.
   *
   * A name a card already holds — live, or faded — is not offered: a live card
   * is credited at every write that names it (`creditNamedIn`), and a faded one
   * comes back when a NEW memory names it, not from the old ones that were
   * already there when it faded. Each name is its own chunk, so the per-chunk
   * birth cap does not bind; `limit` (sleep's nightly budget) does, and the
   * names past it are counted and offered again the next night.
   *
   * Two processes can run this at once (a session's Stop and SessionEnd
   * workers both run the cycle; NOTES, "Card twins"). The index takes in the
   * cards other processes made before the tally (`adopt`), and each birth asks
   * again under the write lock, so a name gets one card whichever runs first.
   */
  birthsFromNames(day: number, opts: NameBirthOptions = {}): NameBirthReport {
    const dryRun = opts.dryRun === true;
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;
    // The cards other processes made since this index was read (the card
    // twins, 2026-10-21): a name one of them holds is not offered.
    this.adopt();
    if (!dryRun) this.relinkUnlinked(day);
    const denied = new Set(this.store.deniedIds());
    const texts = this.store.liveMemoryTexts().filter((m) => !denied.has(m.id));
    const tally = tallyNames(texts, {
      minMemories: TUNABLES.BIRTH_TALLY.MIN_MEMORIES,
      minDays: TUNABLES.BIRTH_TALLY.MIN_DAYS,
      lowerCaseShare: TUNABLES.BIRTH_TALLY.LOWER_CASE_SHARE,
      skip: (name) => this.index.lookup(name).length > 0 || this.faded.lookup(name).length > 0,
    });
    const byId = new Map(texts.map((m) => [m.id, m]));
    const born: string[] = [];
    const refused: Record<string, number> = {};
    // A CARD THE OWNER REMOVED STAYS REMOVED (review of #429). The chase
    // blanks its name and keeps only the ids it linked (store §16 G9), so the
    // name is recognised by its memories: one whose memories cover
    // `REMOVED_COVER` of the removed card's still-live ones is the same name.
    // Its own name covers them all for as long as they say it; an alias hit
    // the card linked may not, hence not 1.
    const removed = this.store
      .cardTombstoneLinks()
      .map((ids) => ids.filter((id) => byId.has(id)))
      .filter((ids) => ids.length > 0);
    const names = tally.names.filter((n) => {
      if (removed.length === 0) return true;
      const mine = new Set(n.memories);
      const taken = removed.some((ids) => ids.filter((id) => mine.has(id)).length >= REMOVED_COVER * ids.length);
      if (taken) refused["removed-by-owner"] = (refused["removed-by-owner"] ?? 0) + 1;
      return !taken;
    });
    let skippedForLimit = 0;
    let attempts = 0;
    names.forEach((n, i) => {
      if (attempts >= limit) {
        skippedForLimit += 1;
        return;
      }
      if (dryRun) {
        attempts += 1;
        return;
      }
      const source = n.memories
        .slice(0, NAME_SOURCE_MEMORIES)
        .map((id) => {
          const m = byId.get(id);
          return m === undefined ? "" : `${m.title ?? ""}\n${m.body}`;
        })
        .join("\n");
      const out = this.mention({ name: n.name, kind: kindForName(n), source, chunkRef: `names:${day}:${i}`, day });
      if (out.born && out.id !== null) {
        attempts += 1;
        born.push(out.id);
      } else {
        refused[out.reason] = (refused[out.reason] ?? 0) + 1;
        // A name offered as free that came back held was given its card by
        // another process running this phase at the same time. It spends
        // tonight's budget here too, so two workers that tally together birth
        // one night's worth between them, not one each (one that tallies after
        // the other has born some can still overshoot; NOTES, "Card twins").
        if (out.reason === "existing") attempts += 1;
      }
    });
    this.emit("schema.births.sweep", undefined, {
      day,
      memories: texts.length,
      offered: names.length,
      born: born.length,
      refused: Object.values(refused).reduce((a, b) => a + b, 0),
      skippedForLimit,
      lowerCase: tally.lowerCase,
      dryRun,
    });
    return { day, dryRun, memories: texts.length, offered: names.length, born, refused, skippedForLimit, lowerCase: tally.lowerCase, attempts };
  }

  /**
   * A TAG THAT MATTERS BECOMES A TOPIC (wave 2 lane B, 2026-10-21; design §1,
   * lightly held): the night's tag tally (`tags.ts#tallyTags`, through the
   * merges) offers every tag over the topic bar (`clearsTopicBar`: memories
   * weighted by use and feeling, lived days, sessions), heaviest first, and
   * each is born a TOPIC CARD — unless it stays a tag (`isStopTag`: a date
   * word, a word with a digit), a card already holds it or one of its merged
   * words as a name (a name is a tag already promoted), or a topic card
   * already holds it (a faded one too, for now). `limit` (the night's
   * `TOPIC_BIRTHS_PER_NIGHT`) at most; the rest wait, counted.
   *
   * A topic card is shaped like the self subject (`Store#ensureSelfSubject`):
   * an entity card with NO name and no aliases, so the alias index links
   * nothing to it — recall's aliases (`retrieval.ts`), the names a memory is
   * linked by and the credit a mention gives are unchanged, which is lane B's
   * promise. Lane E (2026-10-22) reads a topic in recall by its word instead
   * (`tags.ts#topicsNamedIn`, the beliefs slot), never through the index. Its
   * tag and merged words are in `meta.topic` / `meta.topicAliases`, its kind
   * of subject is `topic`, and its memories are the ones tagged — no
   * `memory_subjects` rows. Off (`TAGS_NIGHT`): nothing.
   */
  birthsFromTags(day: number, opts: NameBirthOptions = {}): TopicBirthReport {
    const dryRun = opts.dryRun === true;
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;
    if (!TUNABLES.TAGS_NIGHT) return { day, dryRun, on: false, offered: 0, born: [], refused: {}, skippedForLimit: 0, attempts: 0 };
    const topics = this.store.topicCards();
    const refused: Record<string, number> = {};
    const refuse = (reason: string): false => {
      refused[reason] = (refused[reason] ?? 0) + 1;
      return false;
    };
    const offered = tallyTags(this.store).filter((t) => {
      if (!clearsTopicBar(t)) return false;
      // Any of its words: a later merge can move the canonical word, and the same cluster is one topic.
      if (t.words.some((w) => topics.has(w))) return false;
      if (isStopTag(t.tag)) return refuse("stays-a-tag");
      if (t.words.some((w) => this.index.lookup(w).length > 0 || this.faded.lookup(w).length > 0)) return refuse("a-name-already");
      return true;
    });
    const born: string[] = [];
    let skippedForLimit = 0;
    let attempts = 0;
    for (const t of offered) {
      if (attempts >= limit) {
        skippedForLimit += 1;
        continue;
      }
      attempts += 1;
      // A dry run (the observer's report) counts what a night would try.
      if (dryRun) continue;
      const aliases = t.words.filter((w) => w !== t.tag);
      const seam = clampSalienceAtSeam({ novelty: null, ...ZERO_DIMS }, null);
      // ASKED AGAIN UNDER THE WRITE LOCK (review of #576; the card twins'
      // class): two processes' cycles on one day both read the tally before
      // either wrote, so the "no topic holds it yet" check runs inside the
      // insert's own transaction (`Store#putUnless`).
      const id = this.store.putUnless(
        {
          type: "schema",
          kind: "entity",
          title: t.tag,
          body: `${t.tag}: a topic — the memories tagged with it.`,
          meta: { role: "entity", name: "", aliases: [], topic: t.tag, topicAliases: aliases },
          subjectKind: "topic",
          salience: seam.salience,
          physics: { birthDay: day, lastUsedDay: day },
        },
        () => {
          const now = this.store.topicCards();
          return t.words.some((w) => now.has(w));
        },
      );
      if (id === null) {
        refuse("a-topic-already");
        continue;
      }
      this.remember(id, { role: "entity", name: "", aliases: [] });
      this.index.register(id, "", []);
      born.push(id);
      this.emit("schema.topic.birth", id, { day, memories: t.memories.length, days: t.days, sessions: t.sessions, weight: t.weight });
    }
    this.emit("schema.topics.sweep", undefined, { day, offered: offered.length, born: born.length, skippedForLimit, dryRun });
    return { day, dryRun, on: true, offered: offered.length, born, refused, skippedForLimit, attempts };
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * A row this index must not hold, because the owner removed it.
   *
   * Two states, and the first one is the crash. **Chased:** the row is a
   * tombstone — body and content hash both blanked (`store/owner-op-seam.ts`)
   * — so reading it throws `MEMORY_BODY_MISSING` out of `Schemas.open`, out of
   * `Counterpart.open`, and the hook catches that and exits 0, which is a
   * session with no wake, no recall and no capture and one line on stderr.
   * Free to check: the row is already in hand. **Dark:** marked but not yet
   * chased, so the row and its words are both still there and only the
   * deny-list knows. `denied` is passed in where the caller has a whole WALK to do, so a
   * walk costs one query and not one per row.
   *
   * `load` does not use this — it counts its two skips apart, which this cannot
   * (a blanked pointer alone does not say who blanked it).
   *
   * Skipping is the honest answer. A removed belief or entity is absent from
   * this index, so it is absent from everything built on it; what hangs off a
   * removed entity is orphaned rather than destroyed, and §7b says where that
   * still shows. The store keeps saying `REMOVED` by name to anyone who asks
   * for it by id (`Store.read`), which is where "removed" and "never existed"
   * stay distinguishable.
   */
  private removed(id: string, row: MemoryRow, denied?: ReadonlySet<string>): boolean {
    if (rowTombstoned(row)) return true;
    return denied === undefined ? this.store.deniedIds().includes(id) : denied.has(id);
  }

  /** What `load` left out and whether the store could account for it — see
   *  `load`. Read-only: the caller gets copies, never the counters. */
  loadSkips(): { readonly removed: number; readonly unaccounted: readonly string[] } {
    return { removed: this.skips.removed, unaccounted: [...this.skips.unaccounted] };
  }

  entity(id: string): EntityView | undefined {
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || rec.role !== "entity" || row === undefined) return undefined;
    // One caller, one id: asking the deny-list live is the right cost here, and
    // it is what makes a removal visible to a long-lived process before it
    // reopens. A WALK must not pay it per row — see `entities` below.
    if (this.removed(id, row)) return undefined;
    return entityViewOf(id, rec, row);
  }

  entities(opts: { includeArchived?: boolean } = {}): EntityView[] {
    const out: EntityView[] = [];
    // ONE deny-list query for the whole walk. Asking per entity made this
    // O(entities × removals): at 300 entities it measured 10.4 ms against an
    // empty deny-list and 111 ms against 1,000 removals, and a deny-list only
    // ever grows. `slices()` is built on this.
    const denied = new Set(this.store.deniedIds());
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity") continue;
      const row = this.store.row(id);
      if (row === undefined || this.removed(id, row, denied)) continue;
      const view = entityViewOf(id, rec, row);
      if (view.archived && opts.includeArchived !== true) continue;
      out.push(view);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  element(id: string): ElementView | undefined {
    if (!this.meta.has(id)) this.learn(id);
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || row === undefined) return undefined;
    if (rec.role === "entity") return undefined;
    // ── the removal gate, and it runs BEFORE the prose is read ──────────────
    //
    // Chased: the row is a tombstone, so reading it is the
    // `MEMORY_BODY_MISSING` that used to come out of `Counterpart.open`. Free
    // to see; the row is in hand.
    if (rowTombstoned(row)) return undefined;
    // Dark: marked, not yet chased — the row and its words are both still
    // there, and only
    // the deny-list knows. `physicsOf` asks it (`requireRow` → `refuseIfDenied`)
    // and this call has to happen anyway, so the gate costs nothing; what
    // changed on 2026-09-18 is that it is a STATEMENT, above the read, instead
    // of a field evaluated after `statement` in the literal below. That ordering
    // was luck: reordering two lines lost the gate, and the removed text was
    // read into memory before the throw discarded it — off disk then, off the
    // `body` column since the floor, and loaded either way. An in-process
    // `Schemas` can be older than a removal the owner has since run, which is
    // why the question is asked here and not trusted from `load`.
    let salience;
    try {
      salience = this.store.physicsOf(id).salience;
    } catch (err) {
      // Removed, or the row went while we were looking: no element either way.
      // Anything else is a real store failure and is not this module's to eat.
      if (!isAbsence(err)) throw err;
      return undefined;
    }
    const view: ElementView = {
      id,
      entityId: rec.entityId ?? "",
      role: rec.role,
      statement: readProseWalking(this.store, id, row).body,
      kind: row.kind,
      archived: row.archived === 1,
      supersededBy: row.superseded_by,
      protected: row.protected === 1,
      salience,
    };
    if (rec.statedOn !== undefined) view.statedOn = rec.statedOn;
    if (rec.statedOnDay !== undefined) view.statedOnDay = rec.statedOnDay;
    return view;
  }

  private liveElementIds(entityId: string, role?: SchemaRole): string[] {
    const out: string[] = [];
    for (const id of this.byEntity.get(entityId) ?? []) {
      const rec = this.meta.get(id);
      if (rec === undefined) continue;
      if (role !== undefined && rec.role !== role) continue;
      const row = this.store.row(id);
      if (row === undefined || row.archived === 1) continue;
      out.push(id);
    }
    return out.sort();
  }

  beliefs(entityId: string): ElementView[] {
    this.catchUp();
    return this.beliefsKnown(entityId);
  }

  /** A subject's beliefs as this index knows them, no catch-up: `slices()` catches up once for every card (review of #583). */
  private beliefsKnown(entityId: string): ElementView[] {
    return this.liveElementIds(entityId, "belief")
      .map((id) => this.element(id))
      .filter((e): e is ElementView => e !== undefined);
  }

  /**
   * THE BELIEFS ON A SUBJECT AS THEY STAND (lane C, 2026-10-21): each live
   * belief with its strength on `day`, and how many memories are counted for
   * and against it, strongest first. What a reflection is shown so it can file
   * to a belief rather than write it again. A read.
   */
  beliefStanding(entityId: string, day: number): BeliefStanding[] {
    return this.beliefs(entityId)
      .map((b): BeliefStanding => {
        const rows = this.store.supportOf(b.id);
        const row = this.store.row(b.id);
        let contested = false;
        try {
          contested = this.store.readProse(b.id).meta["contested"] !== undefined;
        } catch {
          contested = false;
        }
        return {
          id: b.id,
          statement: b.statement,
          about: row?.about === "me" ? "me" : row?.about === "us" ? "us" : null,
          strength: strengthOf(this.store.physicsOf(b.id), day),
          support: rows.filter((r) => r.stance === "support").length,
          against: rows.filter((r) => r.stance === "contrary").length,
          contested,
        };
      })
      .sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  }

  /**
   * THE LIVE BELIEF ON A SUBJECT CLOSEST TO A STATEMENT, at or past
   * `BELIEF_NEAR_DUPLICATE` (token cosine, `remember/updates.ts#similarity`),
   * or null (lane C): a birth that close is the same belief said again, and
   * the writer is told to file to it instead. `except`: the belief a birth
   * replaces (says better), never its duplicate. A read.
   */
  nearestBelief(entityId: string, statement: string, except?: string): { id: string; statement: string; similarity: number } | null {
    let best: { id: string; statement: string; similarity: number } | null = null;
    for (const b of this.beliefs(entityId)) {
      // The belief a birth says better is not the one it repeats.
      if (b.id === except) continue;
      const s = similarity(statement, b.statement);
      if (s >= TUNABLES.BELIEF_NEAR_DUPLICATE && (best === null || s > best.similarity)) best = { id: b.id, statement: b.statement, similarity: s };
    }
    return best;
  }

  currentState(entityId: string): ElementView[] {
    return this.liveElementIds(entityId, "current-state")
      .map((id) => this.element(id))
      .filter((e): e is ElementView => e !== undefined);
  }

  /**
   * What the author is shown at encoding (§8 G7). Beliefs and current state are
   * VERBATIM — a paraphrase of a belief cannot be honestly confirmed or
   * contradicted, and contradiction detection is the whole reason the slice
   * exists — and each element carries its ID, the address an `updates:`
   * declaration names. Faded entities are absent: that is what "fades out of
   * preselection" means.
   *
   * `excludeProtected` is the INTERPRETER's view (§14.1 G2: protected elements
   * never render into the falsification path — a model must not be handed the
   * one class of statement it is forbidden to challenge). The filter is
   * PER-ELEMENT, never per-entity, and every filtered element is COUNTED in
   * `elided` rather than silently absent (§5 G8). One builder serves both the
   * prompt cards and the gate slices, so the two surfaces cannot drift.
   */
  slices(opts: { excludeProtected?: boolean } = {}): SchemaSliceOut[] {
    this.catchUp();
    return this.entities().map((e) => {
      let elided = 0;
      const keep = (v: ElementView): boolean => {
        if (opts.excludeProtected === true && v.protected) {
          elided += 1;
          return false;
        }
        return true;
      };
      const beliefs = this.beliefsKnown(e.id)
        .filter(keep)
        .map((b) => ({ id: b.id, statement: b.statement }));
      const currentState = this.currentState(e.id)
        .filter(keep)
        .map((c) => ({ id: c.id, statement: c.statement }));
      return { id: e.id, name: e.name, aliases: [...e.aliases], beliefs, currentState, elided };
    });
  }

  // ── what a memory names (v12, 2026-10-03) ─────────────────────────────────

  /**
   * THE LIVE CARDS A TEXT NAMES — a memory's SUBJECTS — by `creditNamedIn`'s
   * rules: a registered name or alias occurring as a whole word, at least
   * `NAME_MIN_CHARS` long, held by exactly one live card (a handle two cards
   * hold names neither). A faded card is not a subject here: a mention
   * brings one back through `creditNamedIn`, and its rebirth links what
   * names it (`linkNamingMemories`). Sorted ids. The store calls this at every
   * memory write (`Store#findSubjectsWith`, installed by `Counterpart`).
   */
  subjectsIn(text: string): string[] {
    if (text.trim().length === 0) return [];
    return this.subjectsFromHits(this.index.matchesIn(text));
  }

  private subjectsFromHits(hits: readonly { term: string }[]): string[] {
    const out = new Set<string>();
    const seen = new Map<string, string | null>();
    for (const hit of hits) {
      const key = handleKey(hit.term);
      if (key.length < TUNABLES.NAME_MIN_CHARS) continue;
      let holder = seen.get(key);
      if (holder === undefined) {
        const live = this.liveHolders(hit.term);
        holder = live.length === 1 ? (live[0] as string) : null;
        seen.set(key, holder);
      }
      if (holder !== null) out.add(holder);
    }
    return [...out].sort();
  }

  /**
   * A card's birth looks back (v12): every memory already written whose title
   * or body names it — by its own unambiguous terms — is linked to it, `via:
   * birth`. One read of the memories' words and one regex per term. Fail-open:
   * the card is born whatever this does, and an event says so when it fails —
   * and the count is null then, so a caller can tell a failure from "none".
   */
  /**
   * `linkNamingMemories` for several cards in ONE pass over the memories (the
   * twin pass's keepers, review of #593): the same rule per card — its name
   * and aliases, only those it alone holds live — and the same fail-open
   * (a card that fails links nothing, said). Returns the links added and the
   * distinct live memories they are on, or null when the scan itself threw.
   */
  private linkNamingMemoriesOf(cardIds: readonly string[]): { links: number; memories: number } | null {
    // Each term with its lower-cased words: the whole-name regex is slow
    // (~0.6 ms a test on the owner's corpus), so it runs only on a text that
    // holds the term's letters at all — a cheap superset check.
    const cards: { id: string; terms: { re: RegExp; lower: string }[] }[] = [];
    for (const cardId of cardIds) {
      const terms = this.index.termsFor(cardId);
      if (terms === undefined) continue;
      const kept = [terms.name, ...terms.aliases]
        .filter((t) => handleKey(t).length >= TUNABLES.NAME_MIN_CHARS)
        .filter((t) => {
          const live = this.liveHolders(t);
          return live.length === 1 && live[0] === cardId;
        })
        .map((t) => ({ re: nameRegex(t), lower: t.trim().toLowerCase() }));
      if (kept.length > 0) cards.push({ id: cardId, terms: kept });
    }
    if (cards.length === 0) return { links: 0, memories: 0 };
    const links = new Map<string, { memoryId: string; subjectId: string }[]>();
    try {
      for (const m of this.store.memoryTexts()) {
        const text = m.title === null || m.title.length === 0 ? m.body : `${m.title}\n${m.body}`;
        const lower = text.toLowerCase();
        for (const c of cards) {
          if (c.terms.some((t) => lower.includes(t.lower) && t.re.test(text)) && !this.store.subjectsOf(m.id).includes(c.id)) {
            links.set(c.id, [...(links.get(c.id) ?? []), { memoryId: m.id, subjectId: c.id }]);
          }
        }
      }
    } catch (err) {
      this.emit("schema.subjects.failed", undefined, { via: "birth", reason: String((err as { code?: string }).code ?? "UNKNOWN") });
      return null;
    }
    let total = 0;
    const onLive = new Set<string>();
    for (const [cardId, list] of links) {
      try {
        const added = this.store.linkSubjects(list, "birth");
        if (added > 0) this.emit("schema.subjects.linked", cardId, { via: "birth", links: added });
        total += added;
        for (const l of list) if (this.store.row(l.memoryId)?.archived === 0) onLive.add(l.memoryId);
      } catch (err) {
        this.emit("schema.subjects.failed", cardId, { via: "birth", reason: String((err as { code?: string }).code ?? "UNKNOWN") });
      }
    }
    return { links: total, memories: onLive.size };
  }

  private linkNamingMemories(cardId: string): number | null {
    try {
      const terms = this.index.termsFor(cardId);
      if (terms === undefined) return 0;
      const res = [terms.name, ...terms.aliases]
        .filter((t) => handleKey(t).length >= TUNABLES.NAME_MIN_CHARS)
        .filter((t) => {
          const live = this.liveHolders(t);
          return live.length === 1 && live[0] === cardId;
        })
        .map((t) => nameRegex(t));
      if (res.length === 0) return 0;
      const links: { memoryId: string; subjectId: string }[] = [];
      for (const m of this.store.memoryTexts()) {
        const text = m.title === null || m.title.length === 0 ? m.body : `${m.title}\n${m.body}`;
        if (res.some((re) => re.test(text))) links.push({ memoryId: m.id, subjectId: cardId });
      }
      const added = links.length === 0 ? 0 : this.store.linkSubjects(links, "birth");
      if (added > 0) this.emit("schema.subjects.linked", cardId, { via: "birth", links: added });
      return added;
    } catch (err) {
      this.emit("schema.subjects.failed", cardId, { via: "birth", reason: String((err as { code?: string }).code ?? "UNKNOWN") });
      return null;
    }
  }

  /**
   * THE v12 BACKFILL'S READING: every memory with words, against every live
   * card, by `subjectsIn`'s rules — through the index's `scanner`, which
   * gives `matchesIn`'s hits without trying every term on every text. Returns
   * the links to write; writes nothing (`Counterpart` writes them, once).
   */
  subjectLinksForAll(): { links: { memoryId: string; subjectId: string }[]; memories: number; cards: number } {
    const scan = this.index.scanner();
    const links: { memoryId: string; subjectId: string }[] = [];
    let memories = 0;
    for (const m of this.store.memoryTexts()) {
      const text = m.title === null || m.title.length === 0 ? m.body : `${m.title}\n${m.body}`;
      const subjects = this.subjectsFromHits(scan(text)).filter((s) => s !== m.id);
      if (subjects.length === 0) continue;
      memories += 1;
      for (const s of subjects) links.push({ memoryId: m.id, subjectId: s });
    }
    return { links, memories, cards: this.index.size() };
  }

  /** The index recall borrows (SEAMS §6). Live object; treat it as read-only. */
  aliasIndex(): AliasIndex {
    return this.index;
  }

  /** Handle -> ids, the shape `recall/`'s `Turn.aliases` wants. */
  aliasMap(): ReadonlyMap<string, readonly string[]> {
    return this.index.map();
  }

  /** READ ONLY. Promotion is physics'/sleep's counted crossing, never this
   *  module's — there is no write path to a band in this directory. */
  bandOf(id: string, day: number): Band {
    return bandOfPhysics(this.store.physicsOf(id), day);
  }

  /**
   * The revision story of one belief, for the dashboard (constitution line 16):
   * the lineage the store retained, the pressure standing on the live head, the
   * bar it is climbing toward, and every credited increment this session logged.
   */
  story(beliefId: string): BeliefStory {
    const chain: string[] = [];
    let cursor: string | undefined = beliefId;
    const lineage: LineageStep[] = [];
    while (cursor !== undefined && !chain.includes(cursor)) {
      chain.push(cursor);
      for (const v of this.store.versions(cursor)) {
        lineage.push({
          id: cursor,
          seq: v.seq,
          reason: v.reason,
          day: v.version_day,
          successorId: v.successor_id,
        });
      }
      const row: MemoryRow | undefined = this.store.row(cursor);
      const crossed: string | undefined = row?.superseded_by === null ? this.crossedTo(cursor) : undefined;
      if (crossed !== undefined) {
        // A CROSSING THROUGH THE ONE DOOR (2026-10-11, Group 2b): the old row
        // stays live, settled `changed` under the successor (pair source
        // `pressure`), with no forwarding address — the pair is its lineage.
        const pair = this.store.contradictionBetween(crossed, cursor);
        lineage.push({ id: cursor, seq: 0, reason: TUNABLES.REVISED_REASON, day: pair?.settled_day ?? 0, successorId: crossed });
      }
      cursor = row?.superseded_by ?? crossed;
    }
    const headId = chain[chain.length - 1] ?? beliefId;
    const head = this.store.row(headId);
    const p = head === undefined ? undefined : this.store.physicsOf(headId);
    return {
      beliefId,
      headId,
      lineage,
      pressure: p?.pressure ?? 0,
      lastChallengedDay: p?.lastChallengedDay ?? null,
      bar: p === undefined ? 0 : revisionBar(p, p.lastChallengedDay ?? p.birthDay),
      strength: p === undefined ? 0 : strengthOf(p, p.lastChallengedDay ?? p.birthDay),
      increments: this.storyIncrements(chain),
    };
  }

  /** The successor a pressure crossing settled `id` under (a settled pair of source `pressure` over it), or undefined. */
  crossedTo(id: string): string | undefined {
    try {
      const p = (this.store.contradictionsOf([id]).get(id) ?? []).find((c) => c.state === "settled" && c.via === null && c.source === "pressure" && c.over === id && c.holds !== null);
      return p?.holds ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The durable increments first (box 2's `events` table — they survive a
   * restart), then anything this session logged that the log does not already
   * carry. The union is deduped on the same `(target, day, challenger)` latch the
   * append uses, so a story never shows one challenge twice.
   */
  private storyIncrements(chain: readonly string[]): PressureIncrement[] {
    const key = (i: { targetId: string; day: number; challengerId: string }): string =>
      `${i.targetId}:${i.day}:${i.challengerId}`;
    const out: PressureIncrement[] = [];
    const seen = new Set<string>();
    // Read by `ref`, one read per id in the chain, newest first: one read of the
    // whole name kept the OLDEST 1,000 challenges in the store, so once the log
    // held more, the newest chapters of every story were the ones missing. The
    // story is told in the order it happened.
    const rows = chain
      .flatMap((id) => this.store.eventLog({ name: "revision.pressure", ref: id, order: "desc", limit: 1000 }))
      .sort((a, b) => a.seq - b.seq);
    for (const row of rows) {
      if (row.ref === null || !chain.includes(row.ref) || row.payload === null) continue;
      try {
        const p = JSON.parse(row.payload) as Omit<PressureIncrement, "event">;
        const inc: PressureIncrement = { event: "revision.pressure", ...p };
        out.push(inc);
        seen.add(key(inc));
      } catch {
        // An unparseable payload is a lost line of the story, never a throw in
        // the dashboard's read path.
      }
    }
    for (const i of this.increments) {
      if (chain.includes(i.targetId) && !seen.has(key(i))) out.push(i);
    }
    return out;
  }

  /**
   * Guarantee 13: created versus exited, per kind. A kind that has minted
   * entities and never retired one is a defect to investigate, not a base rate
   * to accept (scar §2.17 — write paths ship, curation paths starve).
   */
  lifecycle(): LifecycleRow[] {
    const counts = new Map<Kind, { created: number; exited: number }>();
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity") continue;
      const row = this.store.row(id);
      if (row === undefined) continue;
      const c = counts.get(row.kind) ?? { created: 0, exited: 0 };
      c.created += 1;
      if (row.archived === 1 && row.archived_reason === TUNABLES.FADE_REASON) c.exited += 1;
      counts.set(row.kind, c);
    }
    return [...counts.entries()]
      .map(([kind, c]) => ({
        kind,
        created: c.created,
        exited: c.exited,
        noExitsYet: c.created > 0 && c.exited === 0,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }
}

/** The entity view, built in one place so `entity` and the `entities` walk —
 *  which ask the deny-list differently — cannot drift into two shapes. */
function entityViewOf(id: string, rec: MetaRecord, row: MemoryRow): EntityView {
  return {
    id,
    name: rec.name ?? "",
    kind: row.kind,
    aliases: [...(rec.aliases ?? [])],
    archived: row.archived === 1,
    archivedReason: row.archived_reason,
    birthDay: row.birth_day,
  };
}

/**
 * "There is no memory at this id" — the owner removed it, or the row is gone.
 * Anything else out of a store read is a real failure, and swallowing it here
 * would turn a broken database into a quietly empty index.
 */
function isAbsence(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "REMOVED" || code === "ID_UNKNOWN";
}

/** A newborn schema is empty except its names — a place for memories to attach,
 *  never a claim about what is true of the thing (§14.3, §5 G6). */
function stubBody(name: string, aliases: readonly string[], day: number): string {
  const lines = [`# ${name}`, "", `Born by mention on lived day ${day}. Asserts nothing yet.`];
  if (aliases.length > 0) lines.push("", `Also called: ${aliases.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The DECLARED indices of the aliases the gate kept, in kept order. Drops are
 * reported by the position the author declared them at, never by their text
 * (§5 G10) — so a second drop reason downstream can speak the same language.
 */
function keptIndices(
  declared: readonly string[] | undefined,
  dropped: readonly { index: number }[],
): number[] {
  const gone = new Set(dropped.map((d) => d.index));
  const out: number[] = [];
  (declared ?? []).forEach((_, i) => {
    if (!gone.has(i)) out.push(i);
  });
  return out;
}

function toMetaRecord(meta: Record<string, unknown>): MetaRecord | null {
  const role = meta["role"];
  if (role !== "entity" && role !== "belief" && role !== "current-state") return null;
  const rec: MetaRecord = { role };
  if (typeof meta["name"] === "string") rec.name = meta["name"];
  if (Array.isArray(meta["aliases"])) {
    rec.aliases = (meta["aliases"] as unknown[]).filter((a): a is string => typeof a === "string");
  }
  if (typeof meta["entityId"] === "string") rec.entityId = meta["entityId"];
  if (typeof meta["statedOn"] === "string") rec.statedOn = meta["statedOn"];
  if (typeof meta["statedOnDay"] === "number") rec.statedOnDay = meta["statedOnDay"];
  return rec;
}

/** The lived and calendar floors a card of this kind must pass to fade (NOTES §14). */
function fadeFloors(kind: Kind): { lived: number; calendar: number } {
  const factor = TUNABLES.FADE.LIVED_DWELL_FACTOR_BY_KIND[kind] ?? 1;
  return {
    lived: Math.ceil(PHYSICS_TUNABLES.D_FLOOR_DAYS * factor),
    calendar: TUNABLES.FADE.CALENDAR_FLOOR_DAYS_BY_KIND[kind] ?? TUNABLES.FADE.CALENDAR_FLOOR_DAYS,
  };
}

/** Whole calendar days from one `YYYY-MM-DD` to another; null when either is unreadable. */
function calendarDaysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
