import { gateProposal } from "./battery.js";
import { preselectSchemas } from "./preselect.js";
import { computeNovelty } from "./salience.js";
import { occursAsWholeWord } from "./words.js";
export function encodeChunk(input, opts = {}) {
  const schemas = input.schemas ?? [];
  const events = [];
  const preselectInput = {
    chunkRef: input.chunkRef,
    span: input.span,
    schemas
  };
  if (input.chunkVector !== undefined)
    preselectInput.chunkVector = input.chunkVector;
  if (opts.semanticCap !== undefined)
    preselectInput.semanticCap = opts.semanticCap;
  if (opts.semanticFloor !== undefined)
    preselectInput.semanticFloor = opts.semanticFloor;
  const preselection = preselectSchemas(preselectInput);
  events.push(...preselection.events);
  const shownIds = new Set(preselection.shown.map((s) => s.id));
  const contextVectors = schemas.filter((s) => shownIds.has(s.id)).map((s) => s.vector).filter((v) => v !== null && v !== undefined && v.length > 0);
  const novelty = computeNovelty(input.chunkVector, contextVectors);
  const gated = [];
  const channels = [preselection.semantic];
  for (const proposal of input.proposals) {
    const outcome = gateProposal({ proposal, span: input.span, novelty }, opts);
    gated.push(outcome.gated);
    events.push(...outcome.events);
    for (const c of outcome.channels) {
      if (!channels.some((existing) => existing.channel === c.channel))
        channels.push(c);
    }
  }
  const accepted = gated.filter((g) => g.accepted);
  const refused = gated.filter((g) => !g.accepted);
  const fullyGated = input.proposals.length > 0 && accepted.length === 0;
  const observer = input.observer === true;
  let effects = [];
  if (fullyGated) {
    events.push({
      event: "encode.fullyGated",
      ref: input.chunkRef,
      data: {
        proposals: input.proposals.length,
        refused: refused.length
      }
    });
  } else if (observer) {
    events.push({
      event: "encode.observer.standdown",
      ref: input.chunkRef,
      data: { accepted: accepted.length, suppressedEffects: true }
    });
  } else {
    effects = buildEffects(accepted, preselection, schemas);
  }
  events.push({
    event: "encode.chunk",
    ref: input.chunkRef,
    data: {
      day: input.day,
      proposals: input.proposals.length,
      accepted: accepted.length,
      refused: refused.length,
      fullyGated,
      blind: preselection.blind,
      noveltyReason: novelty.reason,
      effects: effects.length,
      observer
    }
  });
  return {
    chunkRef: input.chunkRef,
    day: input.day,
    accepted,
    refused,
    fullyGated,
    effects,
    preselection,
    novelty,
    channels,
    events,
    observer
  };
}
function buildEffects(accepted, preselection, schemas) {
  const effects = [];
  const byId = new Map(schemas.map((s) => [s.id, s]));
  for (const a of accepted) {
    effects.push({
      effect: "memory.create",
      ref: a.ref,
      kind: a.kind,
      contentHash: a.contentHash
    });
    for (const sel of preselection.shown) {
      const s = byId.get(sel.id);
      if (s === undefined)
        continue;
      const terms = [s.name, ...s.aliases ?? []];
      if (terms.some((t) => occursAsWholeWord(a.content, t))) {
        effects.push({ effect: "entity.mention", schemaId: sel.id, ref: a.ref });
      }
    }
    if (a.updates !== null) {
      effects.push({ effect: "revision.challenge", targetId: a.updates, ref: a.ref });
    }
  }
  return effects;
}
export function mentionsSchema(content, term) {
  return occursAsWholeWord(content, term);
}
