export const WAKE_BEHIND_KEY = "self.wake.behind";
export const WAKE_CAUGHT_KEY = "self.wake.caught";
export const WAKE_BUILD_KEY = "self.wake.build";
export const WAKE_TRIGGERS = ["page", "write-up", "run-end", "version", "told", "memory", "handoff"];
function parse(raw) {
  try {
    const v = JSON.parse(raw);
    const triggers = Array.isArray(v.triggers) ? WAKE_TRIGGERS.filter((t) => v.triggers.includes(t)) : [];
    return { n: typeof v.n === "number" ? v.n : 0, at: typeof v.at === "number" ? v.at : 0, triggers };
  } catch {
    return null;
  }
}
export function wakeBehind(store) {
  try {
    const raw = store.getMeta(WAKE_BEHIND_KEY);
    if (raw === undefined || raw.length === 0)
      return null;
    if (store.getMeta(WAKE_CAUGHT_KEY) === raw)
      return null;
    const v = parse(raw);
    return { raw, at: v?.at ?? 0, triggers: v?.triggers ?? [] };
  } catch {
    return null;
  }
}
export function markWakeBehind(store, trigger) {
  try {
    const pending = wakeBehind(store);
    const triggers = pending === null ? [trigger] : WAKE_TRIGGERS.filter((t) => t === trigger || pending.triggers.includes(t));
    const n = (parse(store.getMeta(WAKE_BEHIND_KEY) ?? "")?.n ?? 0) + 1;
    store.setMeta(WAKE_BEHIND_KEY, JSON.stringify({ n, at: store.now(), triggers }));
  } catch {}
}
export function noteWakeCaught(store, raw) {
  try {
    store.setMeta(WAKE_CAUGHT_KEY, raw);
  } catch {}
}
export function wakeFromOtherBuild(store, briefingKey, build) {
  if (build === null || build === undefined || build.length === 0)
    return false;
  try {
    if (store.getMeta(briefingKey) === undefined)
      return false;
    return store.getMeta(WAKE_BUILD_KEY) !== build;
  } catch {
    return false;
  }
}
export function noteWakeBuild(store, build) {
  if (build === null || build === undefined || build.length === 0)
    return;
  try {
    store.setMeta(WAKE_BUILD_KEY, build);
  } catch {}
}
