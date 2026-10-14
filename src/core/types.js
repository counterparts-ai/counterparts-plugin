export const MEMORY_SOURCES = [
  "authored",
  "fallback",
  "episode",
  "accommodation",
  "migrated",
  "dreamed",
  "reflection"
];
export const SETTLE_HOWS = ["changed", "corrected", "open"];
export const UNBOUND_SESSION = "mcp";
export const SECOND_HAND_META_KEY = "secondHand";
export const WRITTEN_UP_BY_META_KEY = "writtenUpBy";
export function livedOn(row) {
  if (typeof row.happened_on !== "string" || row.happened_on.length === 0)
    return row.learned_on;
  try {
    const meta = JSON.parse(row.meta);
    return meta[SECOND_HAND_META_KEY] === true ? row.happened_on : row.learned_on;
  } catch {
    return row.learned_on;
  }
}
export function isKnownSession(session) {
  return typeof session === "string" && session.length > 0 && session !== UNBOUND_SESSION;
}
export const ROW_IDS_MAX = 20;
export function boundedIds(ids) {
  const seen = new Set;
  for (const id of ids)
    if (id.length > 0)
      seen.add(id);
  return { ids: [...seen].slice(0, ROW_IDS_MAX), idCount: seen.size };
}
export function isModelId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,63}$/.test(value);
}
