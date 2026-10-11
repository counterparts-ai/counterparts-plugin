/* The pulse: a four-second poll. Particles ride only on events that are
   actually new, and every page that counts is re-read when the store moves. */
import { api } from "../shared/api.js";
import { live, tabs } from "../shared/state.js";
import { prependToLiveFeeds } from "../shared/widgets/feed.js";
import { PAGES } from "./pages.js";

export async function poll() {
  let d;
  try { d = await api("/api/activity?limit=40&sinceSeq=" + live.lastSeq); } catch (e) { return; }
  // THE SECOND QUESTION, AND THE ONE THAT WAS MISSING.
  //
  // "Has anything happened" was asked of the event log alone, and the event log
  // is not the whole truth: a deposit that writes no durable event never moves
  // `lastSeq`, so the refetch never fired and a page left open on the flow tab
  // said `143 came through` forever while the server already answered 144.
  // `/api/meta` carries a row count for exactly this — one cheap request beside
  // the one we were already making.
  //
  // The example was `counterparts note`, and it is no longer one: since
  // `gate.deposit` (2026-09-05) the authored door writes a row like every other
  // door, so a note moves the sequence and lands in the branch below. This stays
  // as the belt — a store seeded around the door, and any future writer that
  // leaves no row — because a freshness check that is only correct while one
  // particular writer happens to log is not a freshness check.
  let meta = null;
  try { meta = await api("/api/meta"); } catch (e) { /* the next tick retries */ }
  const deposited = meta !== null && live.fingerprint !== null &&
    (meta.rows !== live.fingerprint.rows || meta.day !== live.fingerprint.day);
  if (meta !== null) live.fingerprint = { rows: meta.rows, day: meta.day };

  if (d.lastSeq > live.lastSeq) {
    live.lastSeq = d.lastSeq;
    // A new event means the store moved, so everything the pages count moved
    // with it: left open, the flow page silently reported yesterday's numbers
    // beside today's feed. Refresh the counters.
    refreshCounters(meta);
    const fresh = d.events.slice().reverse();
    for (const page of PAGES) if (page.onEvents) page.onEvents(fresh);
    prependToLiveFeeds(fresh);
  } else if (deposited) {
    // A deposit with no event of its own: the counters moved, and the pages
    // that animate say so (the flow page's `onDeposit`).
    refreshCounters(meta);
    for (const page of PAGES) if (page.onDeposit) page.onDeposit();
  }
}

/**
 * What a change to the store changes, re-read. The poll has already asked for
 * `/api/meta`, so it hands it over rather than making the request twice.
 *
 * THE FLOW PAGE WAS NOT THE ONLY PAGE COUNTING. The first fix for the stale
 * `143 came through` refreshed the flow diagram and stopped there, so the
 * OVERVIEW — the page the dashboard opens on, the one in the README's first
 * image — kept its boot-time tiles: `memories held`, `lived days`, the band
 * bars, the identity panel, all frozen at whatever they were when the tab was
 * opened, while the flow tab beside it moved. Same bug, one page over. Every
 * page with a `refresh` (home, then flow) is re-read here, in nav order,
 * from the one signal that catches a deposit with no durable event of its own.
 */
export async function refreshCounters(meta) {
  try {
    const m = meta ?? (await api("/api/meta"));
    live.fingerprint = { rows: m.rows, day: m.day };
  } catch (e) { /* the next poll retries */ }
  for (const page of PAGES) {
    if (!page.refresh || !tabs.loaded[page.name]) continue;
    try { await page.refresh(); } catch (e) { /* the next poll retries */ }
  }
}
