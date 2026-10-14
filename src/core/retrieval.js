export function composeTurn(turn, sources) {
  const out = { ...turn };
  if (sources.schemas !== undefined && turn.aliases === undefined) {
    out.aliases = sources.schemas.aliasMap();
  }
  if (sources.prospective !== undefined && sources.at !== undefined && turn.temporal === undefined) {
    const result = sources.prospective.arrivals({
      at: sources.at,
      ...turn.day === undefined ? {} : { day: turn.day },
      sessionId: turn.sessionId
    });
    out.temporal = result.arrivals.map((a) => ({ id: a.memoryId, weight: a.cueWeight }));
  }
  if (sources.associate !== undefined && turn.spread === undefined) {
    const source = sources.associate;
    out.spread = (seeds, day) => source.spreadFrom(seeds, day);
  }
  return out;
}
export function recallTurn(recall, turn, sources) {
  return recall.recall(composeTurn(turn, sources));
}
