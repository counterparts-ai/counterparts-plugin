/**
 * WHICH STORE THE DASHBOARD ON THIS MACHINE'S PORT SERVES — the one outbound
 * request in the package, and it never leaves the machine.
 *
 * `counterparts dashboard` finds its port taken. A dashboard already serving
 * the same store is the common case (the sidebar's button on the desktop runs
 * the command whether or not one is up), and the right answer there is to open
 * the browser on it, not to fail. Asking it is one GET of `/api/whoami` on
 * 127.0.0.1 — the same question the sidebar asks it — answered with a store id
 * or nothing. No other host, no other path, no body sent, a short timeout.
 *
 * Loaded lazily by `cli/commands-dashboard.ts#realDashboard`, so a console that
 * never hits a taken port never has this in its module graph.
 */
import { STORE_ID_RE } from "../../store-id.js";

/** How long a dashboard that holds the port may take to say which store it serves. */
const PROBE_TIMEOUT_MS = 1500;

/** The store id the dashboard on `port` serves, or null: nothing there, not ours, no id, too slow. */
export async function dashboardStoreAt(port: number): Promise<string | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  try {
    const r = await globalThis.fetch(`http://127.0.0.1:${String(port)}/api/whoami`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const store = ((await r.json()) as { store?: unknown } | null)?.store;
    return typeof store === "string" && STORE_ID_RE.test(store) ? store : null;
  } catch {
    return null;
  }
}
