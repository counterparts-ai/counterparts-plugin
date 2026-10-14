export function lastActive(raw) {
  return raw === undefined || raw.trim().length === 0 ? null : raw;
}
export function metaView(src) {
  const store = src.store;
  const rows = store.list().length;
  return {
    dir: store.dir,
    day: store.livedDay(),
    lastActive: lastActive(store.getMeta("lastActiveDate")),
    observer: true,
    retentionDays: store.retentionDays,
    empty: rows === 0,
    rows,
    generatedAt: Date.now()
  };
}
