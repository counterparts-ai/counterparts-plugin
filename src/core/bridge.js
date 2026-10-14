import { computeNovelty, encodeChunk, gateProposal } from "./encode/index.js";
export function batteryGate(vectors) {
  if (vectors === undefined)
    return (input) => verdictFor(input, computeNovelty(null, []));
  return async (input) => {
    const verdict = verdictFor(input, computeNovelty(null, []));
    if (!verdict.ok)
      return verdict;
    const vec = await vectors.vector(input.title, verdict.content);
    const novelty = computeNovelty(vec, vec === null ? [] : vectors.context(vec));
    return { ...verdict, novelty: novelty.novelty };
  };
}
function verdictFor(input, novelty) {
  const selfAuthored = input.source === "session-end" || input.source === "jot";
  const proposal = {
    ref: input.span?.hash ?? "authored",
    content: input.content,
    kind: input.kind,
    aliases: input.aliases,
    feeling: input.feeling === null ? null : {
      type: input.feeling.feeling,
      quote: input.feeling.quote,
      subject: input.feeling.subject
    },
    selfAuthoredFeeling: selfAuthored,
    claimedSalience: input.claimed
  };
  if (input.title !== null) {
    proposal.title = input.title;
    proposal.handles = [input.title];
  }
  const dims = dimensionsFrom(input.salience);
  if (dims !== null)
    proposal.dimensions = dims;
  const outcome = gateProposal({
    proposal,
    span: input.span?.text ?? input.content,
    novelty
  });
  const g = outcome.gated;
  if (g.accepted) {
    return {
      ok: true,
      content: g.content,
      aliases: g.aliases,
      records: g.records,
      channels: outcome.channels,
      feeling: g.feeling === null ? null : { feeling: g.feeling.type, quote: "", subject: g.feeling.subject }
    };
  }
  return {
    ok: false,
    gate: g.reason,
    reason: g.blockedBy.join("+"),
    refusedByDesign: true,
    records: g.records,
    channels: outcome.channels,
    blockedBy: [...g.blockedBy]
  };
}
function dimensionsFrom(s) {
  const given = [s.relevance, s.emotional, s.predictive].some((v) => typeof v === "number");
  if (!given)
    return null;
  const n = (v) => typeof v === "number" ? v : 0;
  return { relevance: n(s.relevance), emotional: n(s.emotional), predictive: n(s.predictive) };
}
export function gateSweepChunk(chunk, proposals, day, extras = {}, opts = {}) {
  const stripped = proposals.map((p) => ({ ...p, selfAuthoredFeeling: false }));
  const input = {
    ...extras,
    chunkRef: `sweep:${chunk.index}`,
    span: chunk.spans.map((s) => s.text).join(`
`),
    proposals: stripped,
    day
  };
  return encodeChunk(input, opts);
}
export function episodeGate() {
  return (input) => {
    const proposal = {
      ref: `episode:${input.sessionId}`,
      content: input.text,
      kind: "self",
      selfAuthoredFeeling: true
    };
    if (input.handles.length > 0)
      proposal.handles = [...input.handles];
    const outcome = gateProposal({
      proposal,
      span: input.text,
      novelty: computeNovelty(null, [])
    });
    const g = outcome.gated;
    if (g.accepted)
      return { ok: true, text: g.content };
    return { ok: false, gate: g.reason, reason: g.blockedBy.join("+") };
  };
}
