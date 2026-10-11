/**
 * `counterparts repair-dates` — giving the migrated rows back their real dates.
 *
 * THE FINDING (PARALLEL-RUN-STATUS 2026-09-04, LAUNCH-STATUS §I7). 12,334 of the
 * 14,529 migrated memories on the live store carry the IMPORT DAY as `learned_on`:
 * v1's traces mostly had no `created` field, and `store.put` defaulted the date to
 * whatever day the importer ran. `bornDay` kept the real age, so the physics is
 * unaffected and nothing decayed wrongly — but every one of those rows now tells
 * the owner it was learned on a day it was not, and #29/#30 had to render them as
 * an upper bound ("by 2026-09-03 ·") because the row does not say which it is.
 *
 * THE REPAIR IS EVIDENCE, NOT ARITHMETIC. This tool invents no dates. It reads
 * what the migration already carried into each row's prose meta and proposes a
 * date only where something in the row actually says one:
 *
 *   HIGH    the v1 document said so — a `created` (or `created_at` / `date`) field
 *           carried through as `meta.v1Extra`, or an engram-era id that IS a
 *           millisecond timestamp (`…_1721984400000`), which is a fact about when
 *           the row was minted rather than an inference about it.
 *   MEDIUM  something ADJACENT to the row says so — `meta.sessionRef` carrying a
 *           timestamp or a date (a session id dates the conversation, and a trace
 *           from that session was learned during it), or the `statedOn` /
 *           `openedOn` a v1 SCHEMA ELEMENT carried (a real v1 date about the
 *           statement rather than about the encode — one step removed, which is
 *           what separates this tier from the one above).
 *   LOW     the PATH says so — the source path the trace was read from carries a
 *           `YYYY-MM` or a `YYYY-MM-DD` (v1 filed some traces by month). A month
 *           resolves to its first day and says so; that is a bound presented as a
 *           date, so it is the tier nothing applies by default.
 *
 * Every proposal is checked against a window — no earlier than `PLAUSIBLE_FLOOR`,
 * no later than the import day — because a fourteen-digit number that happens to
 * parse is not evidence, and a "learned" date after the day of the import is a
 * contradiction on its face. A stronger tier's candidate that fails the window
 * yields to a weaker one BEHIND it, and that is counted too (`supersededTier`), so
 * the report's tier counts and its rejection counts add up to the target set
 * rather than to some of it.
 *
 * THREE RE-RUN GUARDS, all of them added after an adversarial review reproduced
 * the failure (PR #67 review §2): a second `--apply` on a repaired store wrote ten
 * no-op revisions and ten events for five rows, and at live scale that is ~12K
 * archived documents recording a change that did not happen.
 *
 *   1. **The import day is PINNED, not re-measured.** `measureImportDay` takes the
 *      MODE of `learned_on`, and after a repair the mode can move to a repaired
 *      date — which both narrows the plausibility window and pulls correctly-dated
 *      rows into the target set. So the first run RECORDS the day it used
 *      (`IMPORT_DAY_META`, and the migration writes `MIGRATED_ON_META` for stores
 *      imported from here on), later runs read it back, and a measured day that
 *      disagrees with a recorded one is a REFUSAL rather than a silent winner.
 *   2. **A row that was already repaired is never a target.** `--apply` writes
 *      `meta.dateRepaired` onto the document; a row carrying it is skipped by name.
 *   3. **A proposal equal to the row's current date is never written.** A re-dating
 *      that changes nothing must not archive a version and claim it did.
 *
 * DRY RUN IS THE DEFAULT and `--apply` is the only way past it, exactly as
 * `backfill-claims` works. `--apply` writes through `store.revise`, so the prior
 * document — with its wrong date — is archived into `versions/` first and stays
 * readable: correcting a date is a revision, and constitution 7 says a revision
 * keeps its history. The owner runs `--apply`; nothing here runs it for him.
 */
import { Store, storeExists } from "../../core/store/index.js";
import { utcDate } from "../../core/time.js";

/** No memory in either lineage predates this. A parse below it is a coincidence. */
export const PLAUSIBLE_FLOOR = "2015-01-01";

/** Store meta: the import day THIS TOOL used, written by the first `--apply`. */
export const IMPORT_DAY_META = "repairDates.importDay";
/** Store meta: the day the v1 importer ran, written by `tools/migrate/apply.ts`. */
export const MIGRATED_ON_META = "migratedOn";
/** Prose meta on a repaired document. Read by `self/`'s wake to drop the bound. */
export const DATE_REPAIRED_META = "dateRepaired";

/**
 * A single proposed date carrying more than this share of the target set is a
 * BULK STAMP, not a set of real dates, and the dry run says so in as many words.
 * v1's own importer stamping one day onto everything is exactly what this tool
 * exists to undo, and re-doing it at confidence `high` would be the worst outcome
 * available (PR #67 review §3).
 */
export const BULK_STAMP_SHARE = 0.05;
/**
 * ...and carrying at least this many rows. Without a floor the warning fires on
 * every date in a five-row store, where "50% of the proposals" is one row, and a
 * warning that fires every time is a warning nobody reads. At the live scale this
 * exists for (12,334 rows) five percent is ~600, so the floor never suppresses a
 * real bulk stamp — it only stops the small-store cry of wolf.
 */
export const BULK_STAMP_MIN_ROWS = 5;

export type Confidence = "high" | "medium" | "low";

export interface DateProposal {
  readonly date: string;
  readonly confidence: Confidence;
  /** Which field the date was read out of — printed, so a sample row is checkable. */
  readonly from: string;
  /** How it was read: the shape of the evidence, not its content. */
  readonly how:
    | "v1-date-field"
    | "id-timestamp"
    | "session-timestamp"
    | "session-date"
    | "element-stated-on"
    | "element-opened-on"
    | "path-date"
    | "path-month";
}

export type RefusalReason =
  | "no-evidence"
  | "out-of-window"
  | "already-correct"
  | "already-repaired";

export type ProposalOutcome =
  | {
      readonly ok: true;
      readonly proposal: DateProposal;
      /** A STRONGER candidate existed and failed the window; this one won behind it. */
      readonly superseded: boolean;
    }
  | { readonly ok: false; readonly reason: RefusalReason };

/** v1 frontmatter keys that carried a real encode date. Read in this order. */
const V1_DATE_KEYS = ["created", "created_at", "createdAt", "date", "encoded"] as const;

/** 13 digits starting with 1: epoch ms from 2001-09-09 to 2286. Bounded further below. */
const MS_RUN = /(?<!\d)(1\d{12})(?!\d)/;
const ISO_DAY = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const ISO_MONTH = /(?<!\d)(\d{4})-(\d{2})(?![\d-])/;

const TIER_ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** UTC on purpose: this repairs PRE-v7 rows, whose `learned_on` was UTC. */
function dateOfMs(ms: number): string {
  return utcDate(ms);
}

/** A real calendar day inside the window the store could plausibly have lived. */
function withinWindow(date: string, importDay: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const at = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at)) return false;
  // A round-trip catches 2026-02-31 and friends, which `Date.parse` rolls over.
  if (dateOfMs(at) !== date) return false;
  return date >= PLAUSIBLE_FLOOR && date <= importDay;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * What a migrated row says about its own date, at the strongest tier that says
 * anything AND survives the window. Tiers in order; a stronger candidate that
 * fails the window yields to a weaker one and the result says `superseded: true`,
 * so a silent fall-through is a counted fact rather than an invisible one.
 */
export function proposeDate(meta: Record<string, unknown>, importDay: string): ProposalOutcome {
  if (meta[DATE_REPAIRED_META] !== undefined) return { ok: false, reason: "already-repaired" };

  const candidates: DateProposal[] = [];
  const migratedFrom = str(meta["migratedFrom"]);
  const hash = migratedFrom.lastIndexOf("#");
  const v1Id = hash >= 0 ? migratedFrom.slice(hash + 1) : str(meta["v1Id"]);
  const sourcePath = hash >= 0 ? migratedFrom.slice(0, hash) : migratedFrom;
  // v1's OWN document wins over the envelope around it: the migration writes
  // nothing named `created` at top level today, and if it ever did, the outer
  // wrapper must not shadow the field it was wrapping (review §4).
  const extra = { ...meta, ...record(meta["v1Extra"]) };

  // HIGH — the v1 document carried a date field.
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
        how: "v1-date-field",
      });
      break;
    }
  }

  // HIGH — the engram-era id IS a millisecond timestamp.
  const idMs = MS_RUN.exec(v1Id);
  if (idMs !== null && idMs[1] !== undefined) {
    candidates.push({
      date: dateOfMs(Number(idMs[1])),
      confidence: "high",
      from: "migratedFrom#id",
      how: "id-timestamp",
    });
  }

  // MEDIUM — the session the trace came from.
  const sessionRef = str(meta["sessionRef"]) || str(meta["session"]);
  const sessionMs = MS_RUN.exec(sessionRef);
  if (sessionMs !== null && sessionMs[1] !== undefined) {
    candidates.push({
      date: dateOfMs(Number(sessionMs[1])),
      confidence: "medium",
      from: "sessionRef",
      how: "session-timestamp",
    });
  } else {
    const sessionDay = ISO_DAY.exec(sessionRef);
    if (sessionDay !== null && sessionDay[0] !== undefined) {
      candidates.push({
        date: sessionDay[0],
        confidence: "medium",
        from: "sessionRef",
        how: "session-date",
      });
    }
  }

  // MEDIUM — a v1 SCHEMA ELEMENT's own dates (`tools/migrate/plan.ts` writes both
  // onto element-as-memory rows). Real v1 dates, and better evidence than a path
  // month — but they date the STATEMENT, not the encode, which is why they sit
  // here and not beside `created`.
  for (const [key, how] of [
    ["statedOn", "element-stated-on"],
    ["openedOn", "element-opened-on"],
  ] as const) {
    const raw = str(meta[key]);
    const day = ISO_DAY.exec(raw);
    if (day !== null && day[0] !== undefined) {
      candidates.push({ date: day[0], confidence: "medium", from: `meta.${key}`, how });
    }
  }

  // LOW — the path v1 filed it under.
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
        how: "path-month",
      });
    }
  }

  if (candidates.length === 0) return { ok: false, reason: "no-evidence" };
  const index = candidates.findIndex((c) => withinWindow(c.date, importDay));
  if (index < 0) return { ok: false, reason: "out-of-window" };
  const usable = candidates[index];
  if (usable === undefined) return { ok: false, reason: "out-of-window" };
  // Superseded means a STRONGER tier was available and the window refused it —
  // not merely that some earlier candidate lost, which ordering alone would say.
  const superseded = candidates
    .slice(0, index)
    .some((c) => TIER_ORDER[c.confidence] > TIER_ORDER[usable.confidence]);
  return { ok: true, proposal: usable, superseded };
}

export interface RepairTarget {
  readonly id: string;
  readonly kind: string;
  readonly learnedOn: string;
  readonly outcome: ProposalOutcome;
}

export type ImportDaySource = "flag" | "recorded" | "migration" | "measured";

export interface RepairPlan {
  /** The date the importer stamped. Every target carries it as `learned_on`. */
  readonly importDay: string;
  /** Where the import day came from — never silently re-measured after a repair. */
  readonly importDayFrom: ImportDaySource;
  /** The mode of `learned_on` over live migrated rows, always measured for the report. */
  readonly measuredDay: string;
  /** A recorded day that the measurement contradicts. Non-null means REFUSE. */
  readonly disagreement: { recorded: string; measured: string } | null;
  /** Live migrated rows carrying the import day. */
  readonly targets: readonly RepairTarget[];
  readonly counts: {
    /** LIVE migrated rows — the same set every other number here is over. */
    readonly migrated: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly noEvidence: number;
    readonly outOfWindow: number;
    readonly alreadyCorrect: number;
    readonly alreadyRepaired: number;
    /** Proposals where a STRONGER tier existed and the window refused it. */
    readonly supersededTier: number;
  };
}

export function meetsConfidence(c: Confidence, floor: Confidence): boolean {
  return TIER_ORDER[c] >= TIER_ORDER[floor];
}

/** Live, migrated, not removed — ONE definition, so every count below is over it. */
function liveMigratedIds(store: Store): string[] {
  const denied = new Set(store.deniedIds());
  const out: string[] = [];
  for (const id of store.list()) {
    if (denied.has(id)) continue;
    const row = store.row(id);
    if (row === undefined || row.source !== "migrated") continue;
    if (row.archived === 1 || row.superseded_by !== null) continue;
    out.push(id);
  }
  return out;
}

/**
 * The mode of `learned_on` over LIVE migrated rows — the same denominator every
 * other number in the report uses (review §4: two denominators on adjacent lines).
 *
 * MEASURED IS NOT THE SAME AS TRUSTED. The importer wrote one date onto everything
 * it could not date otherwise, so on an unrepaired store the mode IS the import
 * day. After a repair it need not be: enough rows moved to one recovered date and
 * the mode moves with them. That is why `resolveImportDay` prefers a RECORDED day
 * and treats a disagreement as a refusal.
 */
export function measureImportDay(store: Store): { day: string; migrated: number } {
  const tally = new Map<string, number>();
  const ids = liveMigratedIds(store);
  for (const id of ids) {
    const row = store.row(id);
    if (row === undefined) continue;
    tally.set(row.learned_on, (tally.get(row.learned_on) ?? 0) + 1);
  }
  let day = "";
  let best = 0;
  for (const [d, n] of [...tally].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (n > best) {
      best = n;
      day = d;
    }
  }
  return { day, migrated: ids.length };
}

/**
 * Which day this run treats as the import day, and where it came from.
 *
 * Order: the owner's flag, then the day a previous `--apply` recorded, then the
 * day the migration recorded, then the measurement. A recorded day that the
 * measurement contradicts is reported as a DISAGREEMENT and the command refuses:
 * the two ways that happens are "somebody repaired this store already" and
 * "this is not the store you think it is", and both want a human.
 */
export function resolveImportDay(
  store: Store,
  flag?: string,
): { day: string; from: ImportDaySource; measured: string; disagreement: { recorded: string; measured: string } | null } {
  const measured = measureImportDay(store).day;
  if (flag !== undefined) return { day: flag, from: "flag", measured, disagreement: null };
  const recorded = store.getMeta(IMPORT_DAY_META) ?? store.getMeta(MIGRATED_ON_META) ?? "";
  const from: ImportDaySource = store.getMeta(IMPORT_DAY_META) !== undefined ? "recorded" : "migration";
  if (recorded !== "") {
    const disagreement = measured !== "" && measured !== recorded ? { recorded, measured } : null;
    return { day: recorded, from, measured, disagreement };
  }
  return { day: measured, from: "measured", measured, disagreement: null };
}

/** Read-only, always: the plan is made against an observer store (scar E5). */
export function planRepair(dir: string, importDayFlag?: string): RepairPlan {
  const store = Store.open({ dir, observer: true });
  try {
    const resolved = resolveImportDay(store, importDayFlag);
    const importDay = resolved.day;
    const targets: RepairTarget[] = [];
    const counts = {
      migrated: 0,
      high: 0,
      medium: 0,
      low: 0,
      noEvidence: 0,
      outOfWindow: 0,
      alreadyCorrect: 0,
      alreadyRepaired: 0,
      supersededTier: 0,
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
        counts,
      };
    }
    for (const id of ids) {
      const row = store.row(id);
      if (row === undefined) continue;
      // The repair is for the rows that carry the import day — a migrated row that
      // kept a real v1 date is already right and is never rewritten.
      if (row.learned_on !== importDay) continue;
      let meta: Record<string, unknown> = {};
      try {
        meta = store.readProse(id).meta;
      } catch {
        meta = {};
      }
      let outcome = proposeDate(meta, importDay);
      // A re-dating that changes nothing must not archive a version and claim it
      // did (review §2a). Checked here rather than inside the evidence rules,
      // because "what the row says" and "what the row already reads" are two
      // different questions.
      if (outcome.ok && outcome.proposal.date === row.learned_on) {
        outcome = { ok: false, reason: "already-correct" };
      }
      if (outcome.ok) {
        counts[outcome.proposal.confidence] += 1;
        if (outcome.superseded) counts.supersededTier += 1;
      } else if (outcome.reason === "no-evidence") counts.noEvidence += 1;
      else if (outcome.reason === "already-correct") counts.alreadyCorrect += 1;
      else if (outcome.reason === "already-repaired") counts.alreadyRepaired += 1;
      else counts.outOfWindow += 1;
      targets.push({ id, kind: row.kind, learnedOn: row.learned_on, outcome });
    }
    return {
      importDay,
      importDayFrom: resolved.from,
      measuredDay: resolved.measured,
      disagreement: resolved.disagreement,
      targets,
      counts,
    };
  } finally {
    store.close();
  }
}

export interface RepairIo {
  out(line: string): void;
  err(line: string): void;
}

export const SAMPLE_ROWS = 20;
export const HISTOGRAM_ROWS = 10;

export interface RepairOptions {
  readonly apply?: boolean;
  readonly minConfidence?: Confidence;
  readonly importDay?: string;
  readonly sample?: number;
}

export interface RepairReport {
  readonly plan: RepairPlan;
  readonly wouldWrite: number;
  readonly written: number;
  readonly failures: readonly string[];
  /** Proposed dates by count, commonest first — the bulk-stamp detector. */
  readonly histogram: readonly { date: string; n: number; share: number }[];
  /** Dates carrying more than `BULK_STAMP_SHARE` of the proposals. */
  readonly bulkStamps: readonly string[];
  /** Set when the command refused rather than reported. */
  readonly refused: "import-day-disagreement" | null;
}

/**
 * The command's body. Returns the report so a test can assert on numbers rather
 * than on printed lines; `commands.ts` turns it into an exit code.
 */
export function repairDates(dir: string, io: RepairIo, opts: RepairOptions = {}): RepairReport | null {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return null;
  }
  const floor: Confidence = opts.minConfidence ?? "high";
  const plan = planRepair(dir, opts.importDay);
  const sampleSize = opts.sample ?? SAMPLE_ROWS;
  const empty = { plan, wouldWrite: 0, written: 0, failures: [], histogram: [], bulkStamps: [], refused: null } as const;

  if (plan.counts.migrated === 0) {
    io.out("No migrated memories in this store. Nothing to repair.");
    return empty;
  }

  // THE REFUSAL, BEFORE ANY NUMBER IS PRINTED. A recorded import day the store no
  // longer agrees with means either this store was repaired already or it is not
  // the store the record belongs to. Both want a human, and neither wants a tool
  // that picks a winner (review §2).
  if (plan.disagreement !== null) {
    io.err(
      `repair-dates: this store records an import day of ${plan.disagreement.recorded}, but the commonest date among its live migrated rows is ${plan.disagreement.measured}.`,
    );
    io.err("That usually means the repair has already run here. Nothing has been read further and nothing has changed.");
    io.err(`To go ahead anyway, name the day out loud: --import-day ${plan.disagreement.recorded}`);
    return { ...empty, refused: "import-day-disagreement" };
  }

  if (plan.importDay === "") {
    io.out("No migrated memories carry a date to repair. Nothing to do.");
    return empty;
  }

  const proposable = plan.targets.filter(
    (t) => t.outcome.ok && meetsConfidence(t.outcome.proposal.confidence, floor),
  );

  const source =
    plan.importDayFrom === "flag"
      ? "given with --import-day"
      : plan.importDayFrom === "recorded"
        ? `recorded by an earlier run (store meta ${IMPORT_DAY_META})`
        : plan.importDayFrom === "migration"
          ? `recorded by the migration (store meta ${MIGRATED_ON_META})`
          : "measured: the date most live migrated rows share";
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
    io.out(
      `  (${plan.counts.supersededTier} of the proposals above are a WEAKER tier standing in for a stronger one the window refused.)`,
    );
  }

  // THE HISTOGRAM — the one thing the tier counts cannot show. A v1 importer that
  // stamped one `created` date onto thousands of documents reads as `high` here,
  // and applying it would re-do the very failure this tool exists to undo. Two
  // lines of output stand between the owner and that (review §3).
  const byDate = new Map<string, number>();
  for (const t of proposable) {
    if (!t.outcome.ok) continue;
    byDate.set(t.outcome.proposal.date, (byDate.get(t.outcome.proposal.date) ?? 0) + 1);
  }
  const histogram = [...byDate]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([date, n]) => ({ date, n, share: proposable.length === 0 ? 0 : n / proposable.length }));
  const isBulk = (h: { n: number; share: number }): boolean =>
    h.share > BULK_STAMP_SHARE && h.n >= BULK_STAMP_MIN_ROWS;
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
      io.out(
        `WARNING: ${bulkStamps.length} date(s) each carry more than ${(BULK_STAMP_SHARE * 100).toFixed(0)}% of the proposals: ${bulkStamps.join(", ")}.`,
      );
      io.out("A v1 importer that stamped one date onto everything reads exactly like this. Look before you apply.");
    }
  }

  const sample = proposable.slice(0, sampleSize);
  if (sample.length > 0) {
    io.out("");
    io.out(`Sample (${sample.length} of ${proposable.length}) — ids and dates only:`);
    io.out("  id                 kind      now         ->  proposed    confidence  read from");
    for (const t of sample) {
      if (!t.outcome.ok) continue;
      const p = t.outcome.proposal;
      io.out(
        `  ${t.id.padEnd(18)} ${t.kind.padEnd(9)} ${t.learnedOn}  ->  ${p.date}  ${p.confidence.padEnd(10)}  ${p.from} (${p.how})`,
      );
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
  const failures: string[] = [];
  let written = 0;
  try {
    // PIN THE DAY BEFORE THE FIRST WRITE. From here on the mode of `learned_on`
    // is no longer the import day, and a later run that re-measured would narrow
    // its own window and pull correctly-dated rows in (review §2b).
    if (store.getMeta(IMPORT_DAY_META) === undefined) store.setMeta(IMPORT_DAY_META, plan.importDay);
    for (const t of proposable) {
      if (!t.outcome.ok) continue;
      const p = t.outcome.proposal;
      // The third guard, at the last possible moment: never write X -> X.
      if (p.date === t.learnedOn) continue;
      try {
        // `revise` archives the prior document first, so the wrong date stays
        // readable in `versions/` — a correction, with its history kept. The
        // marker rides the same write: `self/`'s wake reads it to stop rendering
        // a repaired date as an upper bound.
        store.revise(t.id, {
          learnedOn: p.date,
          meta: {
            [DATE_REPAIRED_META]: {
              confidence: p.confidence,
              how: p.how,
              from: p.from,
              previous: t.learnedOn,
            },
          },
          reason: "date.repaired",
        });
        store.appendEvent({
          name: "date.repaired",
          day: store.livedDay(),
          ref: t.id,
          payload: { from: t.learnedOn, to: p.date, confidence: p.confidence, how: p.how },
        });
        written += 1;
      } catch (err) {
        failures.push(`${t.id}: ${String((err as Error).message ?? err)}`);
      }
    }
  } finally {
    store.close();
  }

  io.out("");
  io.out(`Re-dated ${written} memories.`);
  io.out(`Import day ${plan.importDay} recorded in store meta (${IMPORT_DAY_META}); a re-run will not re-measure it.`);
  for (const f of failures) io.err(`  FAILED ${f}`);
  return { plan, wouldWrite: proposable.length, written, failures, histogram, bulkStamps, refused: null };
}
