import {
  applyChallenge,
  band as bandOfPhysics,
  clampSalienceAtSeam,
  pruneVerdict,
  revisionBar,
  strength as strengthOf,
  successorSeed,
  supersedeRecord,
  TUNABLES as PHYSICS_TUNABLES
} from "../physics/index.js";
import { gateAliases } from "../encode/aliases.js";
import { containsSecret, redactSecrets } from "../encode/secrets.js";
import { nameRegex, occursAsWholeWord } from "../encode/words.js";
import { Store, hashText } from "../store/index.js";
import { readProseWalking } from "../store/walk-seam.js";
import { rowTombstoned } from "../store/index.js";
import { AliasIndex, collision, handleKey } from "./aliases.js";
import { TUNABLES } from "./tunables.js";
import { tallyNames } from "./names.js";
import {
  BIRTH_KINDS,
  isBirthKind
} from "./types.js";

export * from "./types.js";
export { AliasIndex, collision, handleKey, nameTokens } from "./aliases.js";
export { TUNABLES } from "./tunables.js";
export const PUBLIC_SURFACE = [
  "mention",
  "creditNamedIn",
  "addAliases",
  "addBelief",
  "addCurrentState",
  "challengeBelief",
  "replaceCurrentState",
  "fadeSweep",
  "birthsFromNames",
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
  "crossedTo",
  "lifecycle",
  "events",
  "subjectsIn",
  "subjectLinksForAll"
];
const EVENT_RING = 500;
const NAME_SOURCE_MEMORIES = 20;
const REMOVED_COVER = 0.8;
function kindForName(n) {
  const person = n.titledKinds["person"] ?? 0;
  const place = n.titledKinds["place"] ?? 0;
  const entity = n.titledKinds["entity"] ?? 0;
  if (person > 0 && person >= place && person >= entity)
    return "person";
  if (place > 0 && place >= entity)
    return "place";
  return "entity";
}
const ZERO_DIMS = { relevance: 0, emotional: 0, predictive: 0 };

export class Schemas {
  store;
  index = new AliasIndex;
  faded = new AliasIndex;
  meta = new Map;
  byEntity = new Map;
  birthsPerChunk = new Map;
  increments = [];
  ring = [];
  skips = { removed: 0, unaccounted: [] };
  onEvent;
  retarget;
  constructor(opts) {
    this.store = opts.store;
    this.onEvent = opts.onEvent;
    this.retarget = opts.retarget;
    this.load();
  }
  static open(opts) {
    return new Schemas(opts);
  }
  load() {
    const denied = new Set(this.store.deniedIds());
    for (const id of this.store.list({ type: "schema" })) {
      const row = this.store.row(id);
      if (row === undefined)
        continue;
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
      if (rec === null)
        continue;
      this.remember(id, rec);
      if (rec.role === "entity" && row.archived === 0) {
        this.index.register(id, rec.name ?? "", rec.aliases ?? []);
      } else if (rec.role === "entity" && row.archived_reason === TUNABLES.FADE_REASON) {
        this.faded.register(id, rec.name ?? "", rec.aliases ?? []);
      }
    }
  }
  remember(id, rec) {
    this.meta.set(id, rec);
    if (rec.entityId !== undefined) {
      const set = this.byEntity.get(rec.entityId) ?? new Set;
      set.add(id);
      this.byEntity.set(rec.entityId, set);
    }
  }
  emit(event, ref, data) {
    const e = { at: Date.now(), event };
    if (ref !== undefined)
      e.ref = ref;
    if (data !== undefined)
      e.data = data;
    this.ring.push(e);
    if (this.ring.length > EVENT_RING)
      this.ring.shift();
    this.onEvent?.(e);
  }
  events(name) {
    return this.ring.filter((e) => name === undefined || e.event === name).map((e) => ({ ...e }));
  }
  mention(input) {
    const name = input.name.trim();
    const nameHash = hashText(handleKey(name));
    this.emit("schema.mention", input.chunkRef, {
      nameHash,
      kind: input.kind,
      day: input.day,
      aliasesDeclared: input.aliases?.length ?? 0
    });
    const refuse = (reason) => this.refuseBirth(input, nameHash, reason);
    if (input.kind === "self")
      return refuse("second-self-refused");
    if (!isBirthKind(input.kind))
      return refuse("kind-not-allowed");
    if (name.length < TUNABLES.NAME_MIN_CHARS)
      return refuse("name-empty");
    if (containsSecret(name))
      return refuse("name-is-secret");
    if (!occursAsWholeWord(input.source, name))
      return refuse("name-not-in-source");
    return this.settle(name, input.kind, input, nameHash, true);
  }
  settle(name, kind, input, nameHash, capped) {
    const exact = this.liveHolders(name);
    if (exact.length > 1)
      return this.refuseBirth(input, nameHash, "ambiguous-existing-name", exact);
    const hit = exact[0];
    if (hit !== undefined) {
      const row = this.store.row(hit);
      if (row?.kind === "self")
        return this.refuseBirth(input, nameHash, "second-self-refused", [hit]);
      if (row !== undefined && row.kind !== kind) {
        return this.refuseBirth(input, nameHash, "collision-exact-different-kind", [hit]);
      }
      return this.reMention(hit, input, nameHash);
    }
    const near = this.nearCollisions(name);
    if (near.length > 0)
      return this.refuseBirth(input, nameHash, "collision-near", near);
    const used = this.birthsPerChunk.get(input.chunkRef) ?? 0;
    if (capped && used >= TUNABLES.MAX_BIRTHS_PER_CHUNK) {
      return this.refuseBirth(input, nameHash, "birth-cap-per-chunk");
    }
    return this.birth(name, kind, input, nameHash);
  }
  refuseBirth(input, nameHash, reason, collidedWith = []) {
    this.emit("schema.birth.refused", input.chunkRef, {
      nameHash,
      kind: input.kind,
      reason,
      collided: collidedWith.length
    });
    return {
      ok: false,
      reason,
      id: null,
      born: false,
      collidedWith,
      droppedAliases: [],
      keptAliases: [],
      reinforced: false
    };
  }
  liveHolders(term) {
    return this.index.lookup(term).filter((id) => this.meta.get(id)?.role === "entity" && !this.fadedElsewhere(id));
  }
  creditNamedIn(input) {
    const report = { credited: [], refused: [], revived: [], ambiguous: 0 };
    if (input.text.trim().length === 0)
      return report;
    const except = new Set(input.except ?? []);
    const terms = new Map;
    for (const hit of this.index.matchesIn(input.text)) {
      this.liveHolders(hit.term);
      terms.set(handleKey(hit.term), hit.term);
    }
    for (const hit of this.faded.matchesIn(input.text))
      terms.set(handleKey(hit.term), hit.term);
    const named = new Set;
    const fading = new Set;
    let denied;
    const removedIds = () => denied ??= new Set(this.store.deniedIds());
    for (const [key, term] of terms) {
      if (key.length < TUNABLES.NAME_MIN_CHARS)
        continue;
      const live = this.liveHolders(term);
      const faded = this.fadedHolders(term, removedIds);
      if (live.length + faded.length > 1) {
        report.ambiguous += 1;
        continue;
      }
      if (live[0] !== undefined)
        named.add(live[0]);
      if (faded[0] !== undefined)
        fading.add(faded[0]);
    }
    for (const id of [...named].sort()) {
      if (except.has(id) || this.store.row(id)?.kind === "self")
        continue;
      const credit = this.store.reinforce(id, input.day, TUNABLES.MENTION_TIER);
      (credit.credited ? report.credited : report.refused).push(id);
      this.emit("schema.mention.named", id, {
        day: input.day,
        ref: input.ref,
        credited: credit.credited,
        creditReason: credit.reason
      });
    }
    for (const priorId of [...fading].sort()) {
      const out = this.revive(priorId, input);
      if (out === null)
        continue;
      if (out.born)
        report.revived.push(out.id);
      else if (out.reason === "existing")
        (out.reinforced ? report.credited : report.refused).push(out.id);
    }
    return report;
  }
  fadedHolders(term, removedIds) {
    const ids = this.faded.lookup(term);
    if (ids.length === 0)
      return [];
    const denied = removedIds();
    const byName = new Map;
    for (const id of ids) {
      const rec = this.meta.get(id);
      const row = this.store.row(id);
      if (rec === undefined || row === undefined || row.archived !== 1 || this.removed(id, row, denied)) {
        this.faded.unregister(id);
        continue;
      }
      const key = handleKey(rec.name ?? "");
      if (this.liveHolders(rec.name ?? "").some((l) => handleKey(this.meta.get(l)?.name ?? "") === key))
        continue;
      const prev = byName.get(key);
      if (prev === undefined || row.birth_day > prev.birth || row.birth_day === prev.birth && id > prev.id) {
        byName.set(key, { id, birth: row.birth_day });
      }
    }
    return [...byName.values()].map((v) => v.id).sort();
  }
  revive(priorId, input) {
    const rec = this.meta.get(priorId);
    const kind = this.store.row(priorId)?.kind;
    if (rec === undefined || kind === undefined || !isBirthKind(kind))
      return null;
    const name = rec.name ?? "";
    const aliases = rec.aliases ?? [];
    const out = this.settle(name, kind, { name, kind, source: [name, ...aliases].join(`
`), chunkRef: input.ref, aliases, day: input.day }, hashText(handleKey(name)), false);
    this.emit("schema.mention.revived", out.id ?? priorId, {
      day: input.day,
      ref: input.ref,
      priorId,
      reason: out.reason
    });
    return out;
  }
  fadedNamed(name, except) {
    const key = handleKey(name);
    for (const [id, rec] of this.meta) {
      if (id === except || rec.role !== "entity")
        continue;
      if (handleKey(rec.name ?? "") !== key)
        continue;
      const row = this.store.row(id);
      if (row?.archived === 1 && row.archived_reason === TUNABLES.FADE_REASON)
        return id;
    }
    return;
  }
  fadedElsewhere(id) {
    const row = this.store.row(id);
    if (row?.archived !== 1)
      return false;
    this.index.unregister(id);
    const rec = this.meta.get(id);
    if (rec !== undefined && row.archived_reason === TUNABLES.FADE_REASON) {
      this.faded.register(id, rec.name ?? "", rec.aliases ?? []);
    }
    return true;
  }
  nearCollisions(name) {
    const out = [];
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity")
        continue;
      if (!this.index.has(id))
        continue;
      const terms = [rec.name ?? "", ...rec.aliases ?? []];
      if (terms.some((t) => collision(name, t) === "near") && !this.fadedElsewhere(id))
        out.push(id);
    }
    return out.sort();
  }
  reMention(id, input, nameHash) {
    const credit = this.store.reinforce(id, input.day, TUNABLES.MENTION_TIER);
    this.emit("schema.mention.existing", id, {
      nameHash,
      day: input.day,
      credited: credit.credited,
      creditReason: credit.reason
    });
    return {
      ok: true,
      reason: "existing",
      id,
      born: false,
      collidedWith: [],
      droppedAliases: [],
      keptAliases: this.index.termsFor(id)?.aliases ?? [],
      reinforced: credit.credited
    };
  }
  birth(name, kind, input, nameHash) {
    const gated = gateAliases(input.aliases, input.source);
    const dropped = gated.dropped.map((d) => ({ index: d.index, reason: d.reason }));
    const kept = [];
    keptIndices(input.aliases, gated.dropped).forEach((declaredIndex, i) => {
      const alias = gated.kept[i];
      if (alias === undefined)
        return;
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
      physics: { birthDay: input.day, lastUsedDay: input.day }
    });
    this.remember(id, { role: "entity", name, aliases: kept });
    this.index.register(id, name, kept);
    this.birthsPerChunk.set(input.chunkRef, (this.birthsPerChunk.get(input.chunkRef) ?? 0) + 1);
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
      chunkRef: input.chunkRef
    });
    return {
      ok: true,
      reason: "born",
      id,
      born: true,
      collidedWith: [],
      droppedAliases: dropped,
      keptAliases: kept,
      reinforced: false
    };
  }
  addAliases(id, aliases, source, day) {
    const rec = this.meta.get(id);
    if (rec === undefined || rec.role !== "entity") {
      this.emit("schema.alias.refused", id, { reason: "entity-unknown" });
      return { ok: false, reason: "entity-unknown", kept: [], dropped: [] };
    }
    const gated = gateAliases(aliases, source);
    const dropped = gated.dropped.map((d) => ({ index: d.index, reason: d.reason }));
    const existing = rec.aliases ?? [];
    const kept = [...existing];
    keptIndices(aliases, gated.dropped).forEach((declaredIndex, i) => {
      const alias = gated.kept[i];
      if (alias === undefined)
        return;
      if (this.index.lookup(alias).filter((o) => o !== id).length > 0) {
        dropped.push({ index: declaredIndex, reason: "alias-resolves-elsewhere" });
        return;
      }
      if (!kept.some((k) => handleKey(k) === handleKey(alias)))
        kept.push(alias);
    });
    const next = { role: "entity", name: rec.name ?? "", aliases: kept };
    this.store.revise(id, { meta: { role: "entity", name: next.name, aliases: kept }, reason: "alias-op" });
    this.meta.set(id, next);
    this.index.register(id, next.name ?? "", kept);
    for (const d of dropped) {
      this.emit("schema.alias.dropped", id, { index: d.index, reason: d.reason });
    }
    this.emit("schema.alias.registered", id, { kept: kept.length, dropped: dropped.length, day });
    return { ok: true, reason: "registered", kept, dropped };
  }
  addBelief(input) {
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
      ...input.channel === undefined ? {} : { channel: input.channel },
      protectedFlag: input.protected === true,
      meta: { groundedIn: [...input.groundedIn ?? []] }
    });
    this.emit("schema.belief.added", put, {
      entityId: input.entityId,
      kind: entity.row.kind,
      day: input.day,
      protected: input.protected === true
    });
    return { ok: true, reason: "added", id: put };
  }
  addCurrentState(input) {
    const entity = this.requireEntity(input.entityId);
    if (entity.problem !== null) {
      this.emit("schema.placement.refused", input.entityId, { reason: entity.problem });
      return { ok: false, reason: entity.problem, id: null, belongsOn: null };
    }
    if (entity.row.kind === "self") {
      const reason = "status-on-identity-refused";
      this.emit("schema.placement.refused", input.entityId, {
        reason,
        day: input.day,
        statementHash: hashText(input.statement)
      });
      return { ok: false, reason, id: null, belongsOn: [...BIRTH_KINDS] };
    }
    const statement = input.statement.trim();
    if (statement.length === 0) {
      this.emit("schema.placement.refused", input.entityId, { reason: "statement-empty" });
      return { ok: false, reason: "statement-empty", id: null, belongsOn: null };
    }
    const statedOn = input.statedOn ?? this.store.today();
    const id = this.mintElement({
      role: "current-state",
      entityId: input.entityId,
      kind: entity.row.kind,
      body: statement,
      day: input.day,
      dimensions: input.dimensions,
      claimedSalience: input.claimedSalience ?? null,
      ...input.channel === undefined ? {} : { channel: input.channel },
      protectedFlag: false,
      happenedOn: statedOn,
      meta: { statedOn, statedOnDay: input.day }
    });
    this.emit("schema.state.placed", id, {
      entityId: input.entityId,
      kind: entity.row.kind,
      day: input.day,
      statedOn
    });
    return { ok: true, reason: "placed", id, belongsOn: null };
  }
  requireEntity(id) {
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || rec.role !== "entity" || row === undefined) {
      return { problem: "entity-unknown", row: row ?? {} };
    }
    if (row.archived === 1)
      return { problem: "entity-archived", row };
    return { problem: null, row };
  }
  mintElement(spec) {
    const channel = spec.channel ?? "authored";
    let salience;
    if (spec.salience !== undefined) {
      salience = spec.salience;
    } else {
      const seam = clampSalienceAtSeam({ novelty: null, ...spec.dimensions ?? ZERO_DIMS }, spec.claimedSalience, channel === "fallback" ? PHYSICS_TUNABLES.SWEEP_CLAIM_CEILING : 1);
      if (seam.event !== null) {
        this.emit("salience.lifted", spec.entityId, {
          computed: seam.event.computed,
          claimed: seam.event.claimed,
          applied: seam.event.applied,
          ceiling: seam.event.ceiling,
          capped: seam.event.capped
        });
      }
      salience = seam.salience;
    }
    const meta = {
      role: spec.role,
      entityId: spec.entityId,
      ...spec.meta ?? {}
    };
    const put = {
      type: "schema",
      kind: spec.kind,
      body: redactSecrets(spec.body),
      meta,
      salience,
      physics: {
        birthDay: spec.day,
        lastUsedDay: spec.day,
        protected: spec.protectedFlag,
        ...spec.seed ?? {}
      },
      ...spec.channel === undefined ? {} : { source: spec.channel }
    };
    if (spec.happenedOn !== undefined)
      put.happenedOn = spec.happenedOn;
    const id = this.store.put(put);
    const rec = { role: spec.role, entityId: spec.entityId };
    if (spec.meta?.["statedOn"] !== undefined)
      rec.statedOn = spec.meta["statedOn"];
    if (spec.meta?.["statedOnDay"] !== undefined) {
      rec.statedOnDay = spec.meta["statedOnDay"];
    }
    this.remember(id, rec);
    return id;
  }
  challengeBelief(input) {
    const refuse = (reason, targetId) => {
      this.emit("schema.revision.refused", targetId ?? input.updates, {
        reason,
        challengerId: input.challengerId,
        day: input.day
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
        increment: null
      };
    };
    if (input.updates.trim().length === 0)
      return refuse("no-declared-target", null);
    let targetId;
    try {
      targetId = this.store.resolve(input.updates);
    } catch {
      return refuse("target-unresolvable", null);
    }
    const retargeted = targetId !== input.updates;
    if (retargeted) {
      this.emit("schema.revision.retargeted", targetId, {
        declared: input.updates,
        day: input.day
      });
    }
    const rec = this.meta.get(targetId);
    if (rec === undefined || rec.role !== "belief")
      return refuse("target-not-a-belief", targetId);
    const row = this.store.row(targetId);
    if (row === undefined)
      return refuse("target-unresolvable", targetId);
    if (row.archived === 1)
      return refuse("target-archived", targetId);
    const target = this.store.physicsOf(targetId);
    if (target.protected)
      return refuse("protected-refuses-revision", targetId);
    const challengerRow = this.store.row(input.challengerId);
    if (challengerRow === undefined)
      return refuse("challenger-unknown", targetId);
    const challenger = this.store.physicsOf(input.challengerId);
    const outcome = applyChallenge(targetId, target, { id: input.challengerId, declaredUpdates: targetId, physics: challenger }, input.day);
    let increment = null;
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
          bar: log.bar
        };
        this.increments.push(increment);
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
            bar: log.bar
          }
        });
        this.emit("revision.pressure", targetId, {
          day: log.day,
          challengerId: log.challengerId,
          force: log.force,
          pressureAfter: log.pressureAfter,
          bar: log.bar
        });
      }
    }
    let successorId = null;
    if (outcome.verdict === "revise") {
      successorId = this.supersedeBelief(targetId, rec, row, input, challenger);
    }
    return {
      verdict: outcome.verdict,
      reason: outcome.reason,
      credited: outcome.credited,
      targetId,
      retargeted,
      successorId,
      force: outcome.force,
      pressureBefore: outcome.pressureBefore,
      pressureAfter: outcome.pressureAfter,
      bar: outcome.bar,
      increment
    };
  }
  supersedeBelief(targetId, rec, row, input, challenger) {
    const entityId = rec.entityId ?? "";
    const successorId = this.supersedeElement({
      targetId,
      row,
      role: "belief",
      entityId,
      input,
      challenger,
      reason: TUNABLES.REVISED_REASON,
      indexRec: { role: "belief", entityId }
    });
    this.emit("schema.belief.revised", successorId, {
      predecessorId: targetId,
      entityId,
      day: input.day
    });
    return successorId;
  }
  replaceCurrentState(input) {
    const refuse = (reason, targetId) => {
      this.emit("schema.state.replace.refused", targetId ?? undefined, {
        reason,
        challengerId: input.challengerId,
        day: input.day
      });
      return { ok: false, reason, targetId, retargeted: false, successorId: null };
    };
    if (input.updates.trim().length === 0)
      return refuse("no-declared-target", null);
    let targetId;
    try {
      targetId = this.store.resolve(input.updates);
    } catch {
      return refuse("target-unresolvable", null);
    }
    const retargeted = targetId !== input.updates;
    if (retargeted) {
      this.emit("schema.revision.retargeted", targetId, {
        declared: input.updates,
        day: input.day
      });
    }
    const rec = this.meta.get(targetId);
    if (rec === undefined || rec.role !== "current-state") {
      return refuse("target-not-current-state", targetId);
    }
    const row = this.store.row(targetId);
    if (row === undefined)
      return refuse("target-unresolvable", targetId);
    if (row.archived === 1)
      return refuse("target-archived", targetId);
    if (this.store.physicsOf(targetId).protected) {
      return refuse("protected-refuses-revision", targetId);
    }
    if (this.store.row(input.challengerId) === undefined) {
      return refuse("challenger-unknown", targetId);
    }
    const challenger = this.store.physicsOf(input.challengerId);
    const entityId = rec.entityId ?? "";
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
      indexRec: { role: "current-state", entityId, statedOn, statedOnDay: input.day }
    });
    this.emit("schema.state.replaced", successorId, {
      predecessorId: targetId,
      entityId,
      day: input.day,
      statedOn
    });
    return { ok: true, reason: "replaced", targetId, retargeted, successorId };
  }
  supersedeElement(spec) {
    const { targetId, input } = spec;
    const statement = (input.statement ?? this.store.readProse(input.challengerId).body).trim();
    const seed = successorSeed(this.store.physicsOf(targetId));
    const put = {
      type: "schema",
      kind: spec.row.kind,
      body: statement,
      meta: {
        role: spec.role,
        entityId: spec.entityId,
        revisedFrom: targetId,
        groundedIn: [input.challengerId],
        ...spec.meta ?? {}
      },
      salience: spec.challenger.salience,
      physics: { birthDay: input.day, lastUsedDay: input.day, ...seed },
      source: "accommodation",
      origin: { ref: input.challengerId }
    };
    if (spec.happenedOn !== undefined)
      put.happenedOn = spec.happenedOn;
    const successorId = this.store.supersede(targetId, put, spec.reason);
    this.remember(successorId, spec.indexRec);
    if (this.retarget !== undefined) {
      try {
        this.retarget(targetId, successorId, input.day);
        this.emit("schema.edges.retargeted", targetId, { successorId, day: input.day });
      } catch (err) {
        this.emit("schema.edges.retarget.failed", targetId, {
          successorId,
          day: input.day,
          error: err instanceof Error ? err.name : "UNKNOWN"
        });
      }
    }
    const record = supersedeRecord(targetId, successorId, input.day);
    this.emit("memory.superseded", targetId, {
      successorId,
      day: record.day,
      resolvableUntilDay: record.resolvableUntilDay
    });
    return successorId;
  }
  fadeVerdict(id, day, date = this.store.today()) {
    const row = this.store.row(id);
    const rec = this.meta.get(id);
    if (row === undefined || rec === undefined || rec.role !== "entity") {
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
        calendarFloorDays: 0
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
        calendarFloorDays: floors.calendar
      };
    }
    const v = pruneVerdict(p, day, { inLiveRevisionChain: false });
    const attached = this.liveElementIds(id).length;
    const blockedBy = v.blockedBy.filter((r) => r !== "prunable");
    if (attached > 0)
      blockedBy.push("has-live-attached-elements");
    if (row.kind === "self")
      blockedBy.push("identity-core");
    if (v.dwellDays >= PHYSICS_TUNABLES.D_FLOOR_DAYS && v.dwellDays < floors.lived) {
      blockedBy.push("kind-dwell-too-short");
    }
    if (calendar.days < floors.calendar)
      blockedBy.push("calendar-floor-not-passed");
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
      calendarFloorDays: floors.calendar
    };
  }
  calendarDaysSinceUse(id, row, p, day, date) {
    let best = {
      days: Math.max(0, day - p.lastUsedDay),
      source: "lived-days"
    };
    const consider = (from, source) => {
      const d = calendarDaysBetween(from, date);
      if (d !== null && d > best.days)
        best = { days: d, source };
    };
    if (p.lastUsedDay === row.birth_day)
      consider(row.learned_on, "birth-date");
    const anchor = this.fadeAnchor(id);
    if (anchor !== null && anchor.day >= p.lastUsedDay)
      consider(anchor.date, "anchor");
    return best;
  }
  fadeAnchor(id) {
    const raw = this.store.getMeta(`${TUNABLES.FADE_ANCHOR_PREFIX}${id}`);
    if (raw === undefined)
      return null;
    try {
      const v = JSON.parse(raw);
      if (typeof v.day !== "number" || typeof v.date !== "string")
        return null;
      return { day: v.day, date: v.date };
    } catch {
      return null;
    }
  }
  fadeSweep(day, opts = {}) {
    const date = opts.date ?? this.store.today();
    const dryRun = opts.dryRun === true;
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;
    const faded = [];
    const blocked = {};
    const anchors = [];
    let examined = 0;
    let skippedForLimit = 0;
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity")
        continue;
      const row = this.store.row(id);
      if (row === undefined || row.archived === 1)
        continue;
      if (examined >= limit) {
        skippedForLimit += 1;
        continue;
      }
      examined += 1;
      const v = this.fadeVerdict(id, day, date);
      if (!v.fade) {
        for (const r of v.blockedBy)
          blocked[r] = (blocked[r] ?? 0) + 1;
        const anchor = this.fadeAnchor(id);
        if (anchor === null || anchor.day < row.last_used_day) {
          anchors.push([`${TUNABLES.FADE_ANCHOR_PREFIX}${id}`, JSON.stringify({ day, date })]);
        }
        continue;
      }
      faded.push(id);
      if (dryRun)
        continue;
      this.store.archive(id, TUNABLES.FADE_REASON);
      this.index.unregister(id);
      this.faded.register(id, rec.name ?? "", rec.aliases ?? []);
      this.emit("schema.faded", id, {
        day,
        kind: row.kind,
        strength: v.strength,
        dwellDays: v.dwellDays,
        calendarDays: v.calendarDays,
        birthDay: row.birth_day
      });
    }
    if (!dryRun && anchors.length > 0)
      this.store.setMetaMany(anchors);
    const anchored = dryRun ? 0 : anchors.length;
    this.emit("schema.fade.sweep", undefined, {
      day,
      examined,
      faded: faded.length,
      anchored,
      dryRun
    });
    return { day, date, dryRun, examined, faded, blocked, anchored, skippedForLimit };
  }
  birthsFromNames(day, opts = {}) {
    const dryRun = opts.dryRun === true;
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;
    const denied = new Set(this.store.deniedIds());
    const texts = this.store.liveMemoryTexts().filter((m) => !denied.has(m.id));
    const tally = tallyNames(texts, {
      minMemories: TUNABLES.BIRTH_TALLY.MIN_MEMORIES,
      minDays: TUNABLES.BIRTH_TALLY.MIN_DAYS,
      lowerCaseShare: TUNABLES.BIRTH_TALLY.LOWER_CASE_SHARE,
      skip: (name) => this.index.lookup(name).length > 0 || this.faded.lookup(name).length > 0
    });
    const byId = new Map(texts.map((m) => [m.id, m]));
    const born = [];
    const refused = {};
    const removed = this.store.cardTombstoneLinks().map((ids) => ids.filter((id) => byId.has(id))).filter((ids) => ids.length > 0);
    const names = tally.names.filter((n) => {
      if (removed.length === 0)
        return true;
      const mine = new Set(n.memories);
      const taken = removed.some((ids) => ids.filter((id) => mine.has(id)).length >= REMOVED_COVER * ids.length);
      if (taken)
        refused["removed-by-owner"] = (refused["removed-by-owner"] ?? 0) + 1;
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
      const source = n.memories.slice(0, NAME_SOURCE_MEMORIES).map((id) => {
        const m = byId.get(id);
        return m === undefined ? "" : `${m.title ?? ""}
${m.body}`;
      }).join(`
`);
      const out = this.mention({ name: n.name, kind: kindForName(n), source, chunkRef: `names:${day}:${i}`, day });
      if (out.born && out.id !== null) {
        attempts += 1;
        born.push(out.id);
      } else {
        refused[out.reason] = (refused[out.reason] ?? 0) + 1;
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
      dryRun
    });
    return { day, dryRun, memories: texts.length, offered: names.length, born, refused, skippedForLimit, lowerCase: tally.lowerCase };
  }
  removed(id, row, denied) {
    if (rowTombstoned(row))
      return true;
    return denied === undefined ? this.store.deniedIds().includes(id) : denied.has(id);
  }
  loadSkips() {
    return { removed: this.skips.removed, unaccounted: [...this.skips.unaccounted] };
  }
  entity(id) {
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || rec.role !== "entity" || row === undefined)
      return;
    if (this.removed(id, row))
      return;
    return entityViewOf(id, rec, row);
  }
  entities(opts = {}) {
    const out = [];
    const denied = new Set(this.store.deniedIds());
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity")
        continue;
      const row = this.store.row(id);
      if (row === undefined || this.removed(id, row, denied))
        continue;
      const view = entityViewOf(id, rec, row);
      if (view.archived && opts.includeArchived !== true)
        continue;
      out.push(view);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
  element(id) {
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || row === undefined)
      return;
    if (rec.role === "entity")
      return;
    if (rowTombstoned(row))
      return;
    let salience;
    try {
      salience = this.store.physicsOf(id).salience;
    } catch (err) {
      if (!isAbsence(err))
        throw err;
      return;
    }
    const view = {
      id,
      entityId: rec.entityId ?? "",
      role: rec.role,
      statement: readProseWalking(this.store, id, row).body,
      kind: row.kind,
      archived: row.archived === 1,
      supersededBy: row.superseded_by,
      protected: row.protected === 1,
      salience
    };
    if (rec.statedOn !== undefined)
      view.statedOn = rec.statedOn;
    if (rec.statedOnDay !== undefined)
      view.statedOnDay = rec.statedOnDay;
    return view;
  }
  liveElementIds(entityId, role) {
    const out = [];
    for (const id of this.byEntity.get(entityId) ?? []) {
      const rec = this.meta.get(id);
      if (rec === undefined)
        continue;
      if (role !== undefined && rec.role !== role)
        continue;
      const row = this.store.row(id);
      if (row === undefined || row.archived === 1)
        continue;
      out.push(id);
    }
    return out.sort();
  }
  beliefs(entityId) {
    return this.liveElementIds(entityId, "belief").map((id) => this.element(id)).filter((e) => e !== undefined);
  }
  currentState(entityId) {
    return this.liveElementIds(entityId, "current-state").map((id) => this.element(id)).filter((e) => e !== undefined);
  }
  slices(opts = {}) {
    return this.entities().map((e) => {
      let elided = 0;
      const keep = (v) => {
        if (opts.excludeProtected === true && v.protected) {
          elided += 1;
          return false;
        }
        return true;
      };
      const beliefs = this.beliefs(e.id).filter(keep).map((b) => ({ id: b.id, statement: b.statement }));
      const currentState = this.currentState(e.id).filter(keep).map((c) => ({ id: c.id, statement: c.statement }));
      return { id: e.id, name: e.name, aliases: [...e.aliases], beliefs, currentState, elided };
    });
  }
  subjectsIn(text) {
    if (text.trim().length === 0)
      return [];
    return this.subjectsFromHits(this.index.matchesIn(text));
  }
  subjectsFromHits(hits) {
    const out = new Set;
    const seen = new Map;
    for (const hit of hits) {
      const key = handleKey(hit.term);
      if (key.length < TUNABLES.NAME_MIN_CHARS)
        continue;
      let holder = seen.get(key);
      if (holder === undefined) {
        const live = this.liveHolders(hit.term);
        holder = live.length === 1 ? live[0] : null;
        seen.set(key, holder);
      }
      if (holder !== null)
        out.add(holder);
    }
    return [...out].sort();
  }
  linkNamingMemories(cardId) {
    try {
      const terms = this.index.termsFor(cardId);
      if (terms === undefined)
        return 0;
      const res = [terms.name, ...terms.aliases].filter((t) => handleKey(t).length >= TUNABLES.NAME_MIN_CHARS).filter((t) => {
        const live = this.liveHolders(t);
        return live.length === 1 && live[0] === cardId;
      }).map((t) => nameRegex(t));
      if (res.length === 0)
        return 0;
      const links = [];
      for (const m of this.store.memoryTexts()) {
        const text = m.title === null || m.title.length === 0 ? m.body : `${m.title}
${m.body}`;
        if (res.some((re) => re.test(text)))
          links.push({ memoryId: m.id, subjectId: cardId });
      }
      const added = links.length === 0 ? 0 : this.store.linkSubjects(links, "birth");
      if (added > 0)
        this.emit("schema.subjects.linked", cardId, { via: "birth", links: added });
      return added;
    } catch (err) {
      this.emit("schema.subjects.failed", cardId, { via: "birth", reason: String(err.code ?? "UNKNOWN") });
      return 0;
    }
  }
  subjectLinksForAll() {
    const scan = this.index.scanner();
    const links = [];
    let memories = 0;
    for (const m of this.store.memoryTexts()) {
      const text = m.title === null || m.title.length === 0 ? m.body : `${m.title}
${m.body}`;
      const subjects = this.subjectsFromHits(scan(text)).filter((s) => s !== m.id);
      if (subjects.length === 0)
        continue;
      memories += 1;
      for (const s of subjects)
        links.push({ memoryId: m.id, subjectId: s });
    }
    return { links, memories, cards: this.index.size() };
  }
  aliasIndex() {
    return this.index;
  }
  aliasMap() {
    return this.index.map();
  }
  bandOf(id, day) {
    return bandOfPhysics(this.store.physicsOf(id), day);
  }
  story(beliefId) {
    const chain = [];
    let cursor = beliefId;
    const lineage = [];
    while (cursor !== undefined && !chain.includes(cursor)) {
      chain.push(cursor);
      for (const v of this.store.versions(cursor)) {
        lineage.push({
          id: cursor,
          seq: v.seq,
          reason: v.reason,
          day: v.version_day,
          successorId: v.successor_id
        });
      }
      const row = this.store.row(cursor);
      const crossed = row?.superseded_by === null ? this.crossedTo(cursor) : undefined;
      if (crossed !== undefined) {
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
      increments: this.storyIncrements(chain)
    };
  }
  crossedTo(id) {
    try {
      const p = (this.store.contradictionsOf([id]).get(id) ?? []).find((c) => c.state === "settled" && c.via === null && c.source === "pressure" && c.over === id && c.holds !== null);
      return p?.holds ?? undefined;
    } catch {
      return;
    }
  }
  storyIncrements(chain) {
    const key = (i) => `${i.targetId}:${i.day}:${i.challengerId}`;
    const out = [];
    const seen = new Set;
    const rows = chain.flatMap((id) => this.store.eventLog({ name: "revision.pressure", ref: id, order: "desc", limit: 1000 })).sort((a, b) => a.seq - b.seq);
    for (const row of rows) {
      if (row.ref === null || !chain.includes(row.ref) || row.payload === null)
        continue;
      try {
        const p = JSON.parse(row.payload);
        const inc = { event: "revision.pressure", ...p };
        out.push(inc);
        seen.add(key(inc));
      } catch {}
    }
    for (const i of this.increments) {
      if (chain.includes(i.targetId) && !seen.has(key(i)))
        out.push(i);
    }
    return out;
  }
  lifecycle() {
    const counts = new Map;
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity")
        continue;
      const row = this.store.row(id);
      if (row === undefined)
        continue;
      const c = counts.get(row.kind) ?? { created: 0, exited: 0 };
      c.created += 1;
      if (row.archived === 1 && row.archived_reason === TUNABLES.FADE_REASON)
        c.exited += 1;
      counts.set(row.kind, c);
    }
    return [...counts.entries()].map(([kind, c]) => ({
      kind,
      created: c.created,
      exited: c.exited,
      noExitsYet: c.created > 0 && c.exited === 0
    })).sort((a, b) => a.kind.localeCompare(b.kind));
  }
}
function entityViewOf(id, rec, row) {
  return {
    id,
    name: rec.name ?? "",
    kind: row.kind,
    aliases: [...rec.aliases ?? []],
    archived: row.archived === 1,
    archivedReason: row.archived_reason,
    birthDay: row.birth_day
  };
}
function isAbsence(err) {
  const code = err?.code;
  return code === "REMOVED" || code === "ID_UNKNOWN";
}
function stubBody(name, aliases, day) {
  const lines = [`# ${name}`, "", `Born by mention on lived day ${day}. Asserts nothing yet.`];
  if (aliases.length > 0)
    lines.push("", `Also called: ${aliases.join(", ")}`);
  return `${lines.join(`
`)}
`;
}
function keptIndices(declared, dropped) {
  const gone = new Set(dropped.map((d) => d.index));
  const out = [];
  (declared ?? []).forEach((_, i) => {
    if (!gone.has(i))
      out.push(i);
  });
  return out;
}
function toMetaRecord(meta) {
  const role = meta["role"];
  if (role !== "entity" && role !== "belief" && role !== "current-state")
    return null;
  const rec = { role };
  if (typeof meta["name"] === "string")
    rec.name = meta["name"];
  if (Array.isArray(meta["aliases"])) {
    rec.aliases = meta["aliases"].filter((a) => typeof a === "string");
  }
  if (typeof meta["entityId"] === "string")
    rec.entityId = meta["entityId"];
  if (typeof meta["statedOn"] === "string")
    rec.statedOn = meta["statedOn"];
  if (typeof meta["statedOnDay"] === "number")
    rec.statedOnDay = meta["statedOnDay"];
  return rec;
}
function fadeFloors(kind) {
  const factor = TUNABLES.FADE.LIVED_DWELL_FACTOR_BY_KIND[kind] ?? 1;
  return {
    lived: Math.ceil(PHYSICS_TUNABLES.D_FLOOR_DAYS * factor),
    calendar: TUNABLES.FADE.CALENDAR_FLOOR_DAYS_BY_KIND[kind] ?? TUNABLES.FADE.CALENDAR_FLOOR_DAYS
  };
}
function calendarDaysBetween(from, to) {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b))
    return null;
  return Math.round((b - a) / 86400000);
}
