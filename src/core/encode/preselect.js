import { cosine } from "../physics/index.js";
import { redactSecrets } from "./secrets.js";
import { TUNABLES } from "./tunables.js";
import { occursAsWholeWord } from "./words.js";
export function sliceStatementOf(s) {
  return typeof s === "string" ? s : s.statement;
}
export function sliceAddressOf(s) {
  return typeof s === "string" ? null : s.id;
}
function channelRecord(state, reason) {
  return { channel: "semantic-preselection", state, reason };
}
export function preselectSchemas(input) {
  const cap = input.semanticCap ?? TUNABLES.SEMANTIC_CAP;
  const floor = input.semanticFloor ?? TUNABLES.SEMANTIC_FLOOR;
  const schemas = input.schemas;
  const lexicalIds = [];
  for (const s of schemas) {
    const terms = [s.name, ...s.aliases ?? []];
    if (terms.some((t) => occursAsWholeWord(input.span, t)))
      lexicalIds.push(s.id);
  }
  const scores = new Map;
  const semanticSelected = new Set;
  let semantic;
  if (cap <= 0) {
    semantic = channelRecord("off", "cap-zero-deliberately-off");
  } else if (input.chunkVector === null || input.chunkVector === undefined || input.chunkVector.length === 0) {
    semantic = channelRecord("skipped", "no-chunk-vector");
  } else {
    const v = input.chunkVector;
    const ranked = [];
    let mismatched = 0;
    for (const s of schemas) {
      const sv = s.vector;
      if (sv === null || sv === undefined || sv.length === 0)
        continue;
      if (sv.length !== v.length) {
        mismatched += 1;
        continue;
      }
      ranked.push({ id: s.id, score: cosine(v, sv) });
    }
    if (ranked.length === 0) {
      semantic = channelRecord("skipped", mismatched > 0 ? "vector-dimension-mismatch" : "no-schema-vectors");
    } else {
      ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      for (const r of ranked)
        scores.set(r.id, r.score);
      for (const r of ranked.filter((x) => x.score >= floor).slice(0, cap)) {
        semanticSelected.add(r.id);
      }
      semantic = channelRecord("ran", mismatched > 0 ? "ran-with-dropped-vectors" : "ran");
    }
  }
  const semanticIds = [...semanticSelected];
  const shownIds = [...new Set([...lexicalIds, ...semanticIds])];
  const overlapIds = shownIds.filter((id) => lexicalIds.includes(id) && semanticIds.includes(id));
  const semanticOnlyIds = semanticIds.filter((id) => !lexicalIds.includes(id));
  const shown = shownIds.map((id) => {
    const channels = [];
    if (lexicalIds.includes(id))
      channels.push("lexical");
    if (semanticIds.includes(id))
      channels.push("semantic");
    return { id, channels, score: scores.get(id) ?? null };
  });
  const blind = shown.length === 0;
  const events = [
    {
      event: "preselect.shown",
      ref: input.chunkRef,
      data: {
        lexical: lexicalIds.length,
        semantic: semanticIds.length,
        overlap: overlapIds.length,
        shown: shown.length,
        candidates: schemas.length,
        semanticState: semantic.state,
        semanticReason: semantic.reason
      }
    }
  ];
  if (blind) {
    events.push({
      event: "preselect.blind",
      ref: input.chunkRef,
      data: { candidates: schemas.length, semanticState: semantic.state }
    });
  }
  return {
    chunkRef: input.chunkRef,
    shown,
    lexicalIds,
    semanticIds,
    overlapIds,
    semanticOnlyIds,
    blind,
    semantic,
    candidates: schemas.length,
    floor,
    cap,
    events
  };
}
export function renderSchemaContext(pre, schemas, budget = TUNABLES.IDENTITY_CORE_BUDGET) {
  const byId = new Map(schemas.map((s) => [s.id, s]));
  const lines = [];
  for (const sel of pre.shown) {
    const s = byId.get(sel.id);
    if (s === undefined)
      continue;
    const framing = sel.channels.includes("lexical") ? "named in this span" : "named in — or closely related to — this span";
    lines.push(`## ${s.name} (${framing})`);
    for (const b of s.beliefs ?? []) {
      const addr = sliceAddressOf(b);
      lines.push(addr === null ? `- belief: ${sliceStatementOf(b)}` : `- belief [${addr}]: ${sliceStatementOf(b)}`);
    }
    for (const c of s.currentState ?? []) {
      const addr = sliceAddressOf(c);
      lines.push(addr === null ? `- now: ${sliceStatementOf(c)}` : `- now [${addr}]: ${sliceStatementOf(c)}`);
    }
    const core = s.identityCore ?? "";
    if (core.length > 0) {
      if (core.length <= budget)
        lines.push(core);
      else {
        lines.push(core.slice(0, budget));
        lines.push(`[… ${core.length - budget} further characters elided]`);
      }
    }
  }
  if (lines.length === 0)
    lines.push("(no schemas matched this span)");
  return redactSecrets(lines.join(`
`));
}
