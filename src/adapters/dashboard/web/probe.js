import { STORE_ID_RE } from "../../store-id.js";
const PROBE_TIMEOUT_MS = 1500;
export async function dashboardStoreAt(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    return null;
  try {
    const r = await globalThis.fetch(`http://127.0.0.1:${String(port)}/api/whoami`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (!r.ok)
      return null;
    const store = (await r.json())?.store;
    return typeof store === "string" && STORE_ID_RE.test(store) ? store : null;
  } catch {
    return null;
  }
}
