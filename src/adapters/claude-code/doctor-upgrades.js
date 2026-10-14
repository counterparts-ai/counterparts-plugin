import { Store } from "../../core/store/index.js";
import { finding } from "./doctor-finding.js";
const V8_UPGRADE_META = "physics.v8.upgrade";
const V8_CENSUS_META = "physics.v8.census";
export function metaJson(store, key) {
  const raw = store.getMeta(key);
  if (raw === undefined)
    return null;
  try {
    const v = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
export function metaNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
export function upgradeV8Findings(store) {
  const upgrade = metaJson(store, V8_UPGRADE_META);
  if (upgrade === null)
    return [];
  const census = metaJson(store, V8_CENSUS_META);
  const from = typeof upgrade["from"] === "string" ? upgrade["from"] : String(upgrade["from"] ?? "?");
  const rows = metaNum(upgrade["rows"]);
  const kept = metaNum(upgrade["consolidated"]);
  const data = {
    from,
    rows,
    consolidated: kept,
    identity: metaNum(upgrade["identity"]),
    censused: census !== null
  };
  if (census === null) {
    return [
      finding("upgrade-v8", "amber", "Upgrade", `upgraded from schema v${from} to v8 (${String(rows)} memories kept their old consolidation path); the old-versus-new check has not run yet`, "Nothing to do: the next sleep measures it. counterparts doctor then says whether anything moved.", data)
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
    v7WouldPromote: metaNum(census["v7WouldPromote"])
  };
  if (down + weaker + sooner > 0) {
    return [
      finding("upgrade-v8", "red", "Upgrade", `the v8 upgrade moved memories down: of ${String(checked)} checked, ${String(down)} changed band down, ${String(weaker)} got weaker, ${String(sooner)} would be let go sooner`, "Keep this store as it is and report it: the upgrade promised no memory would move down. The copy taken before it is in the snapshots directory.", measured)
    ];
  }
  const road = metaNum(census["v7WouldPromote"]);
  const credited = metaNum(upgrade["legacyReturns"]);
  const roadLine = road > 0 ? `; ${String(road)} ${road === 1 ? "was" : "were"} on the old road to the core and ${road === 1 ? "takes" : "take"} the durability route now (only memories about me or about us become core)` : "";
  const creditLine = credited > 0 ? `; ${String(credited)} had their reinforcement days counted as returns` : "";
  return [
    finding("upgrade-v8", "green", "Upgrade", `Upgrade to v8: ${String(checked)} memories checked by the old arithmetic and the new; none changed band, none weaker, none prunes sooner; ${String(metaNum(census["consolidated"]))} kept their old consolidation${up > 0 ? `; ${String(up)} moved up a band` : ""}${creditLine}${roadLine}`, "", measured)
  ];
}
const V9_UPGRADE_META = "physics.v9.upgrade";
export function upgradeV9Findings(store) {
  const upgrade = metaJson(store, V9_UPGRADE_META);
  if (upgrade === null)
    return [];
  const me = metaNum(upgrade["markedMe"]);
  const owner = metaNum(upgrade["markedOwner"]);
  const candidates = metaNum(upgrade["candidates"]);
  let since = 0;
  let work = 0;
  let floor = false;
  try {
    const marks = store.coreEvents({ action: "about", limit: MARK_ROWS });
    floor = marks.length >= MARK_ROWS;
    for (const e of marks) {
      since += 1;
      if ((e.reason ?? "").startsWith("work"))
        work += 1;
    }
  } catch {
    since = 0;
  }
  return [
    finding("upgrade-v9", "green", "Upgrade", `Upgrade to v9: what a memory is about is now marked by meaning; the old rule was carried so nothing changed overnight — ${String(me)} self ${me === 1 ? "memory" : "memories"} marked about me, ${String(owner)} about the owner (${String(candidates)} core ${candidates === 1 ? "candidate" : "candidates"}); ${floor ? "at least " : ""}${String(since)} ${since === 1 ? "mark" : "marks"} set since (by the writer, a reflection, you or a session)${work > 0 ? `, ${floor ? "at least " : ""}${String(work)} of them "work" (out of the candidates)` : ""}${floor ? ` (only the newest ${String(MARK_ROWS)} were read)` : ""}`, "", { markedMe: me, markedOwner: owner, candidates, marksSince: since, work, marksFloor: floor })
  ];
}
const V10_UPGRADE_META = "contradictions.v10.upgrade";
export function upgradeV10Findings(store) {
  const upgrade = metaJson(store, V10_UPGRADE_META);
  if (upgrade === null)
    return [];
  const flags = metaNum(upgrade["flags"]);
  const pairs = metaNum(upgrade["pairs"]);
  const raised = metaNum(upgrade["raised"]);
  const standing = metaNum(upgrade["standing"]);
  return [
    finding("upgrade-v10", "green", "Upgrade", `Upgrade to v10: a contradiction is a pair now, settled changed, corrected or open, with its record — ${String(flags)} dream ${flags === 1 ? "flag" : "flags"} carried as ${String(pairs)} unsettled ${pairs === 1 ? "pair" : "pairs"} (${String(raised)} already raised awake, ${String(standing)} with both memories still standing)`, "", { flags, pairs, raised, standing })
  ];
}
const V11_UPGRADE_META = "feelings.v11.upgrade";
export function upgradeV11Findings(store) {
  const upgrade = metaJson(store, V11_UPGRADE_META);
  if (upgrade === null)
    return [];
  const feelings = metaNum(upgrade["feelings"]);
  const refiled = metaNum(upgrade["refiled"]);
  const raw = upgrade["moves"];
  const moves = {};
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw))
      moves[k] = metaNum(v);
  }
  const listed = Object.entries(moves).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k} ${String(n)}`).join(", ");
  return [
    finding("upgrade-v11", "green", "Upgrade", `Upgrade to v11: feelings use seven cores now (happy, warm, calm, curious, sad, uneasy, angry) — ${String(refiled)} of ${String(feelings)} recorded ${feelings === 1 ? "feeling" : "feelings"} re-filed${listed.length > 0 ? ` (${listed})` : ""}, each keeping its old core beside it`, "", { feelings, refiled, moves: listed })
  ];
}
export const MARK_ROWS = 1e4;
