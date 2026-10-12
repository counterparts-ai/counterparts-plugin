/** `doctor`'s findings on the store upgrades v8 to v11, read from what each upgrade recorded (moved out of `doctor.ts`, 2026-10-11). */
import { Store } from "../../core/store/index.js";
import { finding } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

/**
 * THE SELF PAGE (2026-09-18, S1) — one line: is there one, how big, how old.
 *
 * GREEN when absent, amber when stale, and never red. A store with no page has
 * not written one yet, which is the correct state of a fresh install and on the
 * first day after this ships — absence is a fact, not a fault, and a line that
 * nags from the moment it lands is a line people learn to read past (the same
 * rule `fired.ts` states for its `blind` rows). Staleness is the reading worth
 * an amber: a page that exists and has stopped being revised means something
 * that was running has stopped.
 *
 * The reading is two row reads and a date comparison, so it sits with the cheap
 * groups rather than with `fired`.
 */
/** The meta rows the v8 upgrade and its census write (`store/operational.ts`, `sleep/upgrade.ts`). */
const V8_UPGRADE_META = "physics.v8.upgrade";

const V8_CENSUS_META = "physics.v8.census";

export function metaJson(store: Store, key: string): Record<string, unknown> | null {
  const raw = store.getMeta(key);
  if (raw === undefined) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function metaNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * DID THE v8 UPGRADE MOVE ANY MEMORY DOWN? (dreaming + consolidation,
 * 2026-09-26.) The migration marks every row it finds as keeping its old
 * consolidation path and records what it found; the first sleep after it
 * measures every memory by the old arithmetic and the new. Green when that
 * census says nothing changed band down, nothing got weaker and nothing prunes
 * sooner; amber while the census has not run yet; red if any memory moved
 * down — the one thing the upgrade promised not to do. A store born at v8 has
 * no upgrade record and gets no line.
 */
export function upgradeV8Findings(store: Store): Finding[] {
  const upgrade = metaJson(store, V8_UPGRADE_META);
  if (upgrade === null) return [];
  const census = metaJson(store, V8_CENSUS_META);
  const from = typeof upgrade["from"] === "string" ? upgrade["from"] : String(upgrade["from"] ?? "?");
  const rows = metaNum(upgrade["rows"]);
  const kept = metaNum(upgrade["consolidated"]);
  const data: Record<string, string | number | boolean | null> = {
    from,
    rows,
    consolidated: kept,
    identity: metaNum(upgrade["identity"]),
    censused: census !== null,
  };
  if (census === null) {
    return [
      finding(
        "upgrade-v8",
        "amber",
        "Upgrade",
        `upgraded from schema v${from} to v8 (${String(rows)} memories kept their old consolidation path); the old-versus-new check has not run yet`,
        "Nothing to do: the next sleep measures it. counterparts doctor then says whether anything moved.",
        data,
      ),
    ];
  }
  const checked = metaNum(census["checked"]);
  const down = metaNum(census["bandDown"]);
  const weaker = metaNum(census["weaker"]);
  const sooner = metaNum(census["pruneSooner"]);
  const up = metaNum(census["bandUp"]);
  const measured = {
    ...data,
    checked,
    bandDown: down,
    bandUp: up,
    weaker,
    pruneSooner: sooner,
    pruneLater: metaNum(census["pruneLater"]),
    legacyConsolidated: metaNum(census["consolidated"]),
    v7WouldPromote: metaNum(census["v7WouldPromote"]),
  };
  // By construction the three down counts read zero: they compare each row
  // with itself, returns set aside, and returns are zero at the upgrade (the
  // arithmetic for existing rows is unchanged). The branch stays as the alarm
  // if that ever stops being true. (Adversarial review of #251.)
  if (down + weaker + sooner > 0) {
    return [
      finding(
        "upgrade-v8",
        "red",
        "Upgrade",
        `the v8 upgrade moved memories down: of ${String(checked)} checked, ${String(down)} changed band down, ${String(weaker)} got weaker, ${String(sooner)} would be let go sooner`,
        "Keep this store as it is and report it: the upgrade promised no memory would move down. The copy taken before it is in the snapshots directory.",
        measured,
      ),
    ];
  }
  // WHAT THE SELF-COMPARISON CANNOT SEE (review of #251): rows the old rules
  // were about to make core. The decision (working default 2026-09-26): they
  // are let go under the new rule — only memories about me or about us become
  // core — and take the DURABILITY route instead: the upgrade credited their
  // reinforcement days as returns, so they fade as slowly as that history
  // earns. Said, green: it is the design, not a fault.
  const road = metaNum(census["v7WouldPromote"]);
  const credited = metaNum(upgrade["legacyReturns"]);
  const roadLine =
    road > 0
      ? `; ${String(road)} ${road === 1 ? "was" : "were"} on the old road to the core and ${road === 1 ? "takes" : "take"} the durability route now (only memories about me or about us become core)`
      : "";
  const creditLine = credited > 0 ? `; ${String(credited)} had their reinforcement days counted as returns` : "";
  return [
    finding(
      "upgrade-v8",
      "green",
      "Upgrade",
      `Upgrade to v8: ${String(checked)} memories checked by the old arithmetic and the new; none changed band, none weaker, none prunes sooner; ${String(metaNum(census["consolidated"]))} kept their old consolidation${up > 0 ? `; ${String(up)} moved up a band` : ""}${creditLine}${roadLine}`,
      "",
      measured,
    ),
  ];
}

/** The meta row the v9 upgrade writes (`store/operational.ts#V9_UPGRADE_KEY`). */
const V9_UPGRADE_META = "physics.v9.upgrade";

/**
 * WHAT THE v9 UPGRADE CARRIED (2026-09-27, reflection + core by meaning),
 * informational. The core's first question moved from a kind label to a mark
 * set by meaning; the upgrade carried the old rule onto the rows it found, so
 * the candidates did not change overnight — this line says so, and how many
 * marks have been set by meaning since. Silent on a store born at v9.
 */
export function upgradeV9Findings(store: Store): Finding[] {
  const upgrade = metaJson(store, V9_UPGRADE_META);
  if (upgrade === null) return [];
  const me = metaNum(upgrade["markedMe"]);
  const owner = metaNum(upgrade["markedOwner"]);
  const candidates = metaNum(upgrade["candidates"]);
  let since = 0;
  let work = 0;
  let floor = false;
  try {
    const marks = store.coreEvents({ action: "about", limit: MARK_ROWS });
    // A FULL READ IS A FLOOR (2026-10-02), as the Reflection line's is.
    floor = marks.length >= MARK_ROWS;
    for (const e of marks) {
      since += 1;
      if ((e.reason ?? "").startsWith("work")) work += 1;
    }
  } catch {
    since = 0;
  }
  return [
    finding(
      "upgrade-v9",
      "green",
      "Upgrade",
      `Upgrade to v9: what a memory is about is now marked by meaning; the old rule was carried so nothing changed overnight — ${String(me)} self ${me === 1 ? "memory" : "memories"} marked about me, ${String(owner)} about the owner (${String(candidates)} core ${candidates === 1 ? "candidate" : "candidates"}); ${floor ? "at least " : ""}${String(since)} ${since === 1 ? "mark" : "marks"} set since (by the writer, a reflection, you or a session)${work > 0 ? `, ${floor ? "at least " : ""}${String(work)} of them "work" (out of the candidates)` : ""}${floor ? ` (only the newest ${String(MARK_ROWS)} were read)` : ""}`,
      "",
      { markedMe: me, markedOwner: owner, candidates, marksSince: since, work, marksFloor: floor },
    ),
  ];
}

/** The meta row the v10 upgrade writes (`store/operational.ts#V10_UPGRADE_KEY`). */
const V10_UPGRADE_META = "contradictions.v10.upgrade";

/**
 * WHAT THE v10 UPGRADE CARRIED (2026-09-29, contradictions), informational:
 * every dream flag that stood became an unsettled pair, raised and habituated
 * as it was. Silent on a store born at v10.
 */
export function upgradeV10Findings(store: Store): Finding[] {
  const upgrade = metaJson(store, V10_UPGRADE_META);
  if (upgrade === null) return [];
  const flags = metaNum(upgrade["flags"]);
  const pairs = metaNum(upgrade["pairs"]);
  const raised = metaNum(upgrade["raised"]);
  const standing = metaNum(upgrade["standing"]);
  return [
    finding(
      "upgrade-v10",
      "green",
      "Upgrade",
      `Upgrade to v10: a contradiction is a pair now, settled changed, corrected or open, with its record — ${String(flags)} dream ${flags === 1 ? "flag" : "flags"} carried as ${String(pairs)} unsettled ${pairs === 1 ? "pair" : "pairs"} (${String(raised)} already raised awake, ${String(standing)} with both memories still standing)`,
      "",
      { flags, pairs, raised, standing },
    ),
  ];
}

/** The meta row the v11 upgrade writes (`store/operational.ts#V11_UPGRADE_KEY`). */
const V11_UPGRADE_META = "feelings.v11.upgrade";

/**
 * WHAT THE v11 UPGRADE RE-FILED (2026-09-30, the feelings wheel v2),
 * informational: how many recorded feelings it read, how many it moved onto
 * the seven cores and from where to where. Each moved row keeps its old core
 * beside it. Silent on a store born at v11.
 */
export function upgradeV11Findings(store: Store): Finding[] {
  const upgrade = metaJson(store, V11_UPGRADE_META);
  if (upgrade === null) return [];
  const feelings = metaNum(upgrade["feelings"]);
  const refiled = metaNum(upgrade["refiled"]);
  const raw = upgrade["moves"];
  const moves: Record<string, number> = {};
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) moves[k] = metaNum(v);
  }
  const listed = Object.entries(moves)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, n]) => `${k} ${String(n)}`)
    .join(", ");
  return [
    finding(
      "upgrade-v11",
      "green",
      "Upgrade",
      `Upgrade to v11: feelings use seven cores now (happy, warm, calm, curious, sad, uneasy, angry) — ${String(refiled)} of ${String(feelings)} recorded ${feelings === 1 ? "feeling" : "feelings"} re-filed${listed.length > 0 ? ` (${listed})` : ""}, each keeping its old core beside it`,
      "",
      { feelings, refiled, moves: listed },
    ),
  ];
}

/** Mark changes the Reflection line reads, newest first; a read that comes back full is a floor. */
export const MARK_ROWS = 10_000;
