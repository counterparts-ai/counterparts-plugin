import { Store, storeExists } from "../../core/store/index.js";
import { utcDate } from "../../core/time.js";
export const PLAUSIBLE_FLOOR = "2015-01-01";
export const IMPORT_DAY_META = "repairDates.importDay";
export const MIGRATED_ON_META = "migratedOn";
export const DATE_REPAIRED_META = "dateRepaired";
export const BULK_STAMP_SHARE = 0.05;
export const BULK_STAMP_MIN_ROWS = 5;
const V1_DATE_KEYS = ["created", "created_at", "createdAt", "date", "encoded"];
const MS_RUN = /(?<!\d)(1\d{12})(?!\d)/;
const ISO_DAY = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const ISO_MONTH = /(?<!\d)(\d{4})-(\d{2})(?![\d-])/;
const TIER_ORDER = { low: 0, medium: 1, high: 2 };
function dateOfMs(ms) {
  return utcDate(ms);
}
function withinWindow(date, importDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return false;
  const at = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at))
    return false;
  if (dateOfMs(at) !== date)
    return false;
  return date >= PLAUSIBLE_FLOOR && date <= importDay;
}
function str(v) {
  return typeof v === "string" ? v : "";
}
function record(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}
export function proposeDate(meta, importDay) {
  if (meta[DATE_REPAIRED_META] !== undefined)
    return { ok: false, reason: "already-repaired" };
  const candidates = [];
  const migratedFrom = str(meta["migratedFrom"]);
  const hash = migratedFrom.lastIndexOf("#");
  const v1Id = hash >= 0 ? migratedFrom.slice(hash + 1) : str(meta["v1Id"]);
  const sourcePath = hash >= 0 ? migratedFrom.slice(0, hash) : migratedFrom;
  const extra = { ...meta, ...record(meta["v1Extra"]) };
  for (const key of V1_DATE_KEYS) {
    const raw = str(extra[key]);
    const day = ISO_DAY.exec(raw);
    if (day !== null && day[0] !== undefined) {
      candidates.push({ date: day[0], confidence: "high", from: `v1Extra.${key}`, how: "v1-date-field" });
      break;
    }
    const ms = MS_RUN.exec(raw);
    if (ms !== null && ms[1] !== undefined) {
      candidates.push({
        date: dateOfMs(Number(ms[1])),
        confidence: "high",
        from: `v1Extra.${key}`,
        how: "v1-date-field"
      });
      break;
    }
  }
  const idMs = MS_RUN.exec(v1Id);
  if (idMs !== null && idMs[1] !== undefined) {
    candidates.push({
      date: dateOfMs(Number(idMs[1])),
      confidence: "high",
      from: "migratedFrom#id",
      how: "id-timestamp"
    });
  }
  const sessionRef = str(meta["sessionRef"]) || str(meta["session"]);
  const sessionMs = MS_RUN.exec(sessionRef);
  if (sessionMs !== null && sessionMs[1] !== undefined) {
    candidates.push({
      date: dateOfMs(Number(sessionMs[1])),
      confidence: "medium",
      from: "sessionRef",
      how: "session-timestamp"
    });
  } else {
    const sessionDay = ISO_DAY.exec(sessionRef);
    if (sessionDay !== null && sessionDay[0] !== undefined) {
      candidates.push({
        date: sessionDay[0],
        confidence: "medium",
        from: "sessionRef",
        how: "session-date"
      });
    }
  }
  for (const [key, how] of [
    ["statedOn", "element-stated-on"],
    ["openedOn", "element-opened-on"]
  ]) {
    const raw = str(meta[key]);
    const day = ISO_DAY.exec(raw);
    if (day !== null && day[0] !== undefined) {
      candidates.push({ date: day[0], confidence: "medium", from: `meta.${key}`, how });
    }
  }
  const pathDay = ISO_DAY.exec(sourcePath);
  if (pathDay !== null && pathDay[0] !== undefined) {
    candidates.push({ date: pathDay[0], confidence: "low", from: "migratedFrom#path", how: "path-date" });
  } else {
    const pathMonth = ISO_MONTH.exec(sourcePath);
    if (pathMonth !== null && pathMonth[1] !== undefined && pathMonth[2] !== undefined) {
      candidates.push({
        date: `${pathMonth[1]}-${pathMonth[2]}-01`,
        confidence: "low",
        from: "migratedFrom#path",
        how: "path-month"
      });
    }
  }
  if (candidates.length === 0)
    return { ok: false, reason: "no-evidence" };
  const index = candidates.findIndex((c) => withinWindow(c.date, importDay));
  if (index < 0)
    return { ok: false, reason: "out-of-window" };
  const usable = candidates[index];
  if (usable === undefined)
    return { ok: false, reason: "out-of-window" };
  const superseded = candidates.slice(0, index).some((c) => TIER_ORDER[c.confidence] > TIER_ORDER[usable.confidence]);
  return { ok: true, proposal: usable, superseded };
}
export function meetsConfidence(c, floor) {
  return TIER_ORDER[c] >= TIER_ORDER[floor];
}
function liveMigratedIds(store) {
  const denied = new Set(store.deniedIds());
  const out = [];
  for (const id of store.list()) {
    if (denied.has(id))
      continue;
    const row = store.row(id);
    if (row === undefined || row.source !== "migrated")
      continue;
    if (row.archived === 1 || row.superseded_by !== null)
      continue;
    out.push(id);
  }
  return out;
}
export function measureImportDay(store) {
  const tally = new Map;
  const ids = liveMigratedIds(store);
  for (const id of ids) {
    const row = store.row(id);
    if (row === undefined)
      continue;
    tally.set(row.learned_on, (tally.get(row.learned_on) ?? 0) + 1);
  }
  let day = "";
  let best = 0;
  for (const [d, n] of [...tally].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    if (n > best) {
      best = n;
      day = d;
    }
  }
  return { day, migrated: ids.length };
}
export function resolveImportDay(store, flag) {
  const measured = measureImportDay(store).day;
  if (flag !== undefined)
    return { day: flag, from: "flag", measured, disagreement: null };
  const recorded = store.getMeta(IMPORT_DAY_META) ?? store.getMeta(MIGRATED_ON_META) ?? "";
  const from = store.getMeta(IMPORT_DAY_META) !== undefined ? "recorded" : "migration";
  if (recorded !== "") {
    const disagreement = measured !== "" && measured !== recorded ? { recorded, measured } : null;
    return { day: recorded, from, measured, disagreement };
  }
  return { day: measured, from: "measured", measured, disagreement: null };
}
export function planRepair(dir, importDayFlag) {
  const store = Store.open({ dir, observer: true });
  try {
    const resolved = resolveImportDay(store, importDayFlag);
    const importDay = resolved.day;
    const targets = [];
    const counts = {
      migrated: 0,
      high: 0,
      medium: 0,
      low: 0,
      noEvidence: 0,
      outOfWindow: 0,
      alreadyCorrect: 0,
      alreadyRepaired: 0,
      supersededTier: 0
    };
    const ids = liveMigratedIds(store);
    counts.migrated = ids.length;
    if (importDay === "") {
      return {
        importDay,
        importDayFrom: resolved.from,
        measuredDay: resolved.measured,
        disagreement: resolved.disagreement,
        targets,
        counts
      };
    }
    for (const id of ids) {
      const row = store.row(id);
      if (row === undefined)
        continue;
      if (row.learned_on !== importDay)
        continue;
      let meta = {};
      try {
        meta = store.readProse(id).meta;
      } catch {
        meta = {};
      }
      let outcome = proposeDate(meta, importDay);
      if (outcome.ok && outcome.proposal.date === row.learned_on) {
        outcome = { ok: false, reason: "already-correct" };
      }
      if (outcome.ok) {
        counts[outcome.proposal.confidence] += 1;
        if (outcome.superseded)
          counts.supersededTier += 1;
      } else if (outcome.reason === "no-evidence")
        counts.noEvidence += 1;
      else if (outcome.reason === "already-correct")
        counts.alreadyCorrect += 1;
      else if (outcome.reason === "already-repaired")
        counts.alreadyRepaired += 1;
      else
        counts.outOfWindow += 1;
      targets.push({ id, kind: row.kind, learnedOn: row.learned_on, outcome });
    }
    return {
      importDay,
      importDayFrom: resolved.from,
      measuredDay: resolved.measured,
      disagreement: resolved.disagreement,
      targets,
      counts
    };
  } finally {
    store.close();
  }
}
export const SAMPLE_ROWS = 20;
export const HISTOGRAM_ROWS = 10;
export function repairDates(dir, io, opts = {}) {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return null;
  }
  const floor = opts.minConfidence ?? "high";
  const plan = planRepair(dir, opts.importDay);
  const sampleSize = opts.sample ?? SAMPLE_ROWS;
  const empty = { plan, wouldWrite: 0, written: 0, failures: [], histogram: [], bulkStamps: [], refused: null };
  if (plan.counts.migrated === 0) {
    io.out("No migrated memories in this store. Nothing to repair.");
    return empty;
  }
  if (plan.disagreement !== null) {
    io.err(`repair-dates: this store records an import day of ${plan.disagreement.recorded}, but the commonest date among its live migrated rows is ${plan.disagreement.measured}.`);
    io.err("That usually means the repair has already run here. Nothing has been read further and nothing has changed.");
    io.err(`To go ahead anyway, name the day out loud: --import-day ${plan.disagreement.recorded}`);
    return { ...empty, refused: "import-day-disagreement" };
  }
  if (plan.importDay === "") {
    io.out("No migrated memories carry a date to repair. Nothing to do.");
    return empty;
  }
  const proposable = plan.targets.filter((t) => t.outcome.ok && meetsConfidence(t.outcome.proposal.confidence, floor));
  const source = plan.importDayFrom === "flag" ? "given with --import-day" : plan.importDayFrom === "recorded" ? `recorded by an earlier run (store meta ${IMPORT_DAY_META})` : plan.importDayFrom === "migration" ? `recorded by the migration (store meta ${MIGRATED_ON_META})` : "measured: the date most live migrated rows share";
  io.out(`Import day: ${plan.importDay} (${source})`);
  io.out(`Live migrated memories: ${plan.counts.migrated}`);
  io.out(`  … of those, carrying the import day: ${plan.targets.length}`);
  io.out("");
  io.out(`Proposals by confidence (over the ${plan.targets.length} rows above):`);
  io.out(`  high     ${plan.counts.high}  — the v1 document's own date, or an id that is a timestamp`);
  io.out(`  medium   ${plan.counts.medium}  — the session it came from, or a v1 element's statedOn / openedOn`);
  io.out(`  low      ${plan.counts.low}  — the path v1 filed it under (a month resolves to its 1st)`);
  io.out(`  none     ${plan.counts.noEvidence}  — nothing in the row says a date; left exactly as it is`);
  io.out(`  rejected ${plan.counts.outOfWindow}  — a date parsed but fell outside ${PLAUSIBLE_FLOOR}..${plan.importDay}`);
  io.out(`  same     ${plan.counts.alreadyCorrect}  — the evidence agrees with the date already there; nothing to write`);
  io.out(`  repaired ${plan.counts.alreadyRepaired}  — an earlier run already re-dated this row`);
  if (plan.counts.supersededTier > 0) {
    io.out(`  (${plan.counts.supersededTier} of the proposals above are a WEAKER tier standing in for a stronger one the window refused.)`);
  }
  const byDate = new Map;
  for (const t of proposable) {
    if (!t.outcome.ok)
      continue;
    byDate.set(t.outcome.proposal.date, (byDate.get(t.outcome.proposal.date) ?? 0) + 1);
  }
  const histogram = [...byDate].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([date, n]) => ({ date, n, share: proposable.length === 0 ? 0 : n / proposable.length }));
  const isBulk = (h) => h.share > BULK_STAMP_SHARE && h.n >= BULK_STAMP_MIN_ROWS;
  const bulkStamps = histogram.filter(isBulk).map((h) => h.date);
  io.out("");
  io.out(`At or above confidence ${floor}: ${proposable.length} rows would be re-dated.`);
  if (histogram.length > 0) {
    io.out("");
    io.out(`Proposed dates by count (${Math.min(HISTOGRAM_ROWS, histogram.length)} of ${histogram.length} distinct):`);
    for (const h of histogram.slice(0, HISTOGRAM_ROWS)) {
      const pct = (h.share * 100).toFixed(1);
      const flag = isBulk(h) ? "  <-- more than 5% on ONE day: check this is not a bulk stamp" : "";
      io.out(`  ${h.date}  ${String(h.n).padStart(6)}  ${pct.padStart(5)}%${flag}`);
    }
    if (bulkStamps.length > 0) {
      io.out("");
      io.out(`WARNING: ${bulkStamps.length} date(s) each carry more than ${(BULK_STAMP_SHARE * 100).toFixed(0)}% of the proposals: ${bulkStamps.join(", ")}.`);
      io.out("A v1 importer that stamped one date onto everything reads exactly like this. Look before you apply.");
    }
  }
  const sample = proposable.slice(0, sampleSize);
  if (sample.length > 0) {
    io.out("");
    io.out(`Sample (${sample.length} of ${proposable.length}) — ids and dates only:`);
    io.out("  id                 kind      now         ->  proposed    confidence  read from");
    for (const t of sample) {
      if (!t.outcome.ok)
        continue;
      const p = t.outcome.proposal;
      io.out(`  ${t.id.padEnd(18)} ${t.kind.padEnd(9)} ${t.learnedOn}  ->  ${p.date}  ${p.confidence.padEnd(10)}  ${p.from} (${p.how})`);
    }
  }
  if (opts.apply !== true) {
    io.out("");
    io.out("Dry run. Nothing has changed. Re-run with --apply to write the dates.");
    return { plan, wouldWrite: proposable.length, written: 0, failures: [], histogram, bulkStamps, refused: null };
  }
  if (proposable.length === 0) {
    io.out("");
    io.out("Nothing to do.");
    return { plan, wouldWrite: 0, written: 0, failures: [], histogram, bulkStamps, refused: null };
  }
  const store = Store.open({ dir });
  const failures = [];
  let written = 0;
  try {
    if (store.getMeta(IMPORT_DAY_META) === undefined)
      store.setMeta(IMPORT_DAY_META, plan.importDay);
    for (const t of proposable) {
      if (!t.outcome.ok)
        continue;
      const p = t.outcome.proposal;
      if (p.date === t.learnedOn)
        continue;
      try {
        store.revise(t.id, {
          learnedOn: p.date,
          meta: {
            [DATE_REPAIRED_META]: {
              confidence: p.confidence,
              how: p.how,
              from: p.from,
              previous: t.learnedOn
            }
          },
          reason: "date.repaired"
        });
        store.appendEvent({
          name: "date.repaired",
          day: store.livedDay(),
          ref: t.id,
          payload: { from: t.learnedOn, to: p.date, confidence: p.confidence, how: p.how }
        });
        written += 1;
      } catch (err) {
        failures.push(`${t.id}: ${String(err.message ?? err)}`);
      }
    }
  } finally {
    store.close();
  }
  io.out("");
  io.out(`Re-dated ${written} memories.`);
  io.out(`Import day ${plan.importDay} recorded in store meta (${IMPORT_DAY_META}); a re-run will not re-measure it.`);
  for (const f of failures)
    io.err(`  FAILED ${f}`);
  return { plan, wouldWrite: proposable.length, written, failures, histogram, bulkStamps, refused: null };
}
