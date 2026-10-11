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
  clampSalienceAtSeam,
  pruneVerdict,
  revisionBar,
  strength as strengthOf,
  successorSeed,
  supersedeRecord,
  TUNABLES as PHYSICS_TUNABLES,
} from "../physics/index.js";
import type { MemoryPhysics } from "../physics/index.js";
import { gateAliases } from "../encode/aliases.js";
import { containsSecret, redactSecrets } from "../encode/secrets.js";
import { nameRegex, occursAsWholeWord } from "../encode/words.js";
import { Store, hashText } from "../store/index.js";
// The WALKING read — not a `Store` method on purpose (`store/walk-seam.ts`): it
// skips the archived-read telemetry AND the deny-list, and this module is one of
// the two files `test/cli.test.ts` allows to import it.
import { readProseWalking } from "../store/walk-seam.js";
import { rowTombstoned } from "../store/index.js";
import type { MemoryRow, PutInput } from "../store/index.js";
import type { Band, Kind, Salience } from "../types.js";
import { AliasIndex, collision, handleKey } from "./aliases.js";
import { TUNABLES } from "./tunables.js";
import {
  BIRTH_KINDS,
  isBirthKind,
} from "./types.js";
import type {
  BeliefInput,
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
} from "./types.js";

export * from "./types.js";
export { AliasIndex, collision, handleKey, nameTokens } from "./aliases.js";
export type { AliasHit, CollisionKind } from "./aliases.js";
export { TUNABLES } from "./tunables.js";

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
  "addCurrentState",
  "challengeBelief",
  "replaceCurrentState",
  "fadeSweep",
  // reads
  "entity",
  "entities",
  "element",
  "beliefs",
  "currentState",
  "slices",
  "loadSkips",
  "aliasIndex",
  "aliasMap",
  "bandOf",
  "fadeVerdict",
  "story",
  "lifecycle",
  "events",
  // v12 (2026-10-03): what a memory names — the store's finder, and the
  // backfill's reading (both reads; the links are the store's to write).
  "subjectsIn",
  "subjectLinksForAll",
] as const;

const EVENT_RING = 500;

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
      const doc = readProseWalking(this.store, id, row);
      const rec = toMetaRecord(doc.meta);
      if (rec === null) continue;
      this.remember(id, rec);
      if (rec.role === "entity" && row.archived === 0) {
        this.index.register(id, rec.name ?? "", rec.aliases ?? []);
      } else if (rec.role === "entity" && row.archived_reason === TUNABLES.FADE_REASON) {
        this.faded.register(id, rec.name ?? "", rec.aliases ?? []);
      }
    }
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
    const id = this.store.put({
      type: "schema",
      kind,
      title: name,
      body: stubBody(name, kept, input.day),
      meta: { role: "entity", name, aliases: kept },
      salience: seam.salience,
      physics: { birthDay: input.day, lastUsedDay: input.day },
    });
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
    const put = this.mintElement({
      role: "belief",
      entityId: input.entityId,
      kind: entity.row.kind,
      body: statement,
      day: input.day,
      dimensions: input.dimensions,
      claimedSalience: input.claimedSalience ?? null,
      ...(input.channel === undefined ? {} : { channel: input.channel }),
      protectedFlag: input.protected === true,
      meta: { groundedIn: [...(input.groundedIn ?? [])] },
    });
    this.emit("schema.belief.added", put, {
      entityId: input.entityId,
      kind: entity.row.kind,
      day: input.day,
      protected: input.protected === true,
    });
    return { ok: true, reason: "added", id: put };
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
        channel === "fallback" ? PHYSICS_TUNABLES.SWEEP_CLAIM_CEILING : 1,
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

    const outcome = applyChallenge(
      targetId,
      target,
      // The RESOLVED id is what physics is told, and the raw declaration stays in
      // the retarget event: the model proposes semantics, the engine resolves
      // references (scar §2.5).
      { id: input.challengerId, declaredUpdates: targetId, physics: challenger },
      input.day,
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
      // an element is as strongly held as what made it (NOTES §3).
      salience: spec.challenger.salience,
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
    return this.liveElementIds(entityId, "belief")
      .map((id) => this.element(id))
      .filter((e): e is ElementView => e !== undefined);
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
    return this.entities().map((e) => {
      let elided = 0;
      const keep = (v: ElementView): boolean => {
        if (opts.excludeProtected === true && v.protected) {
          elided += 1;
          return false;
        }
        return true;
      };
      const beliefs = this.beliefs(e.id)
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
   * the card is born whatever this does, and an event says so when it fails.
   */
  private linkNamingMemories(cardId: string): number {
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
      return 0;
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
      cursor = row?.superseded_by ?? undefined;
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
