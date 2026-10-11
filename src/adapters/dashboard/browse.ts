/**
 * `browse` — the memories, listed; and one memory, opened.
 *
 * Two things this view is required to do, both from CONTRACT §3:
 *
 *   1. **Name the RECORD.** "The owner reads the store itself, not only renderings
 *      of it" (constitution line 6), so an opened memory says which record it is
 *      — id, revision and content hash — and the owner can address it, quote it
 *      and check it against a second reading. For now that is what is printed
 *      here; it used to be the markdown file's path, which named a filesystem
 *      layout rather than the memory.
 *   2. **Resolve ids to text at render time.** Everything an opened memory points
 *      at — what superseded it, what it was grounded in, which schema it hangs
 *      on, what it fires with — is an ID in the store and a RESOLUTION here. None
 *      of it is text this view had lying around (scar §2.20).
 *
 * Sorted by strength, computed now, because "what is strong today" is the
 * question a memory browser is actually asked.
 */
import { band, rep, sal, strength } from "../../core/physics/index.js";
import { isJournal } from "../../core/sleep/index.js";
import type { Band, Kind } from "../../core/types.js";
import { PLAIN } from "./ansi.js";
import type { Style } from "./ansi.js";
import {
  NONE,
  heading,
  indent,
  meter,
  num,
  plural,
  stack,
  subheading,
  table,
  truncate,
} from "./layout.js";
import { gistOf, resolveRef } from "./resolve.js";
import type { DashboardSource } from "./source.js";

export const DEFAULT_LIMIT = 20;

export interface BrowseOptions {
  readonly style?: Style;
  /** Open exactly this memory instead of listing. */
  readonly id?: string;
  readonly band?: Band;
  readonly kind?: Kind;
  /** Include archived rows. They are held, not gone (§4.2 G3). */
  readonly archived?: boolean;
  readonly limit?: number;
}

export function renderBrowse(src: DashboardSource, opts: BrowseOptions = {}): string {
  return opts.id === undefined ? renderList(src, opts) : renderOne(src, opts.id, opts);
}

// ── the list ─────────────────────────────────────────────────────────────────

interface Line {
  readonly id: string;
  readonly strength: number;
  readonly band: Band;
  readonly kind: Kind;
  readonly gist: string;
  readonly archived: string | null;
}

function renderList(src: DashboardSource, opts: BrowseOptions): string {
  const style = opts.style ?? PLAIN;
  const store = src.store;
  const day = store.livedDay();
  const limit = opts.limit ?? DEFAULT_LIMIT;

  // The band filter is COMPUTED, never delegated to the column: until 2026-09-14
  // the stored band was a birth fossil (episodic at mint, identity at promotion
  // — nothing ever wrote "semantic", replay review F6), so
  // `list({ band: "semantic" })` returned nothing forever while the engine held
  // semantic rows. The decay pass reconciles the column now (U8), and this stays
  // computed regardless: the column is only as fresh as the last boundary.
  const filter: { kind?: Kind; archived?: boolean } = {};
  if (opts.kind !== undefined) filter.kind = opts.kind;
  if (opts.archived !== true) filter.archived = false;

  const lines: Line[] = [];
  for (const id of store.list(filter)) {
    const row = store.row(id);
    if (row === undefined) continue;
    // The `memories` table holds episodes too, and `list`'s filter has no way
    // to say "memories only": an episode is the SOURCE a memory was made from,
    // outside every sleep phase (`sleep/types.ts#isJournal`), and `status.ts`
    // already counts it apart. Listed here it would read as a memory with kind
    // `self`, band `episodic` and strength 0.00, and it would be counted in the
    // footer — a census that is wrong by exactly the number of days lived.
    if (isJournal(row)) continue;
    let gist: string;
    let s: number;
    let b: Band;
    try {
      const physics = store.physicsOf(id);
      gist = gistOf(store.readProse(id));
      s = strength(physics, day);
      b = band(physics, day);
    } catch {
      // A row the owner removed, or prose that will not read: it is still a real
      // row, so it is listed as a named absence rather than silently dropped —
      // under its recorded band, the only one an unreadable row has.
      if (opts.band !== undefined && row.band !== opts.band) continue;
      lines.push({
        id,
        strength: 0,
        band: row.band,
        kind: row.kind,
        gist: resolveRef(store, id).label,
        archived: row.archived_reason,
      });
      continue;
    }
    if (opts.band !== undefined && b !== opts.band) continue;
    lines.push({
      id,
      strength: s,
      band: b,
      kind: row.kind,
      gist,
      archived: row.archived === 1 ? (row.archived_reason ?? "archived") : null,
    });
  }
  lines.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  const shown = lines.slice(0, limit);

  const filterNote = [
    opts.band === undefined ? null : `band ${opts.band}`,
    opts.kind === undefined ? null : `kind ${opts.kind}`,
    opts.archived === true ? "archived included" : "live only",
  ]
    .filter((x): x is string => x !== null)
    .join(", ");

  if (shown.length === 0) {
    return stack(
      heading("The memories I hold", style),
      style.warn(`${NONE} — nothing matches (${filterNote}).`),
    );
  }

  const rows: string[][] = [["strength", "", "band", "kind", "what it says", "id"]];
  for (const line of shown) {
    rows.push([
      num(line.strength),
      meter(line.strength, 8),
      line.band,
      line.kind,
      truncate(line.gist, 48) + (line.archived === null ? "" : style.dim(` (${line.archived})`)),
      line.id,
    ]);
  }

  const footer =
    `${plural(lines.length, "memory", "memories")} match ${filterNote}; showing ${shown.length}, strongest first. ` +
    "Open one with `browse --id <id>`.";

  return stack(heading("The memories I hold", style), indent(table(rows, { right: [0] })), footer);
}

// ── one memory, opened ───────────────────────────────────────────────────────

function renderOne(src: DashboardSource, id: string, opts: BrowseOptions): string {
  const style = opts.style ?? PLAIN;
  const store = src.store;
  const day = store.livedDay();

  const ref = resolveRef(store, id);
  if (!ref.present || ref.headId === null) {
    return stack(heading(`Memory ${id}`, style), style.warn(ref.label));
  }
  // Follow the forwarding address: opening a superseded id shows what it BECAME,
  // and says so. The alternative — showing the dead text because the caller
  // typed the dead id — is the failure render-time resolution exists to prevent.
  const headId = ref.headId;
  const doc = store.readProse(headId);
  const row = store.row(headId);
  const physics = store.physicsOf(headId);

  const facts: string[][] = [
    // Which record this is: the id to address it by, the revision it is on, and
    // the hash of the text shown below (constitution line 6 — the owner reads
    // the store itself, and this is what they read it by).
    [
      "record",
      row === undefined
        ? "—"
        : `${headId} · rev ${row.revision} · ${row.content_hash === "" ? "—" : row.content_hash}`,
    ],
    ["kind", physics.kind],
    // Live band first (arithmetic, what the engine acts on); the recorded
    // column is the birth/promotion record and says so (review F6).
    ["band", `${band(physics, day)} (recorded ${row?.band ?? "—"}, set day ${row?.band_day ?? "—"})`],
    [
      "strength",
      `${num(strength(physics, day))}  ${meter(strength(physics, day), 12)}` +
        `   salience ${num(sal(physics.salience))} · repetition ${num(rep(physics))}`,
    ],
    [
      "salience",
      `relevance ${num(physics.salience.relevance)} · emotional ${num(physics.salience.emotional)} · ` +
        `predictive ${num(physics.salience.predictive)} · ` +
        (physics.salience.novelty === null
          ? style.warn("novelty blind (no schema context existed)")
          : `novelty ${num(physics.salience.novelty)}`) +
        (physics.salience.claimed === null || physics.salience.claimed === undefined
          ? ""
          : ` · claimed floor ${num(physics.salience.claimed)}`),
    ],
    [
      "lived",
      `born day ${physics.birthDay} · used ${plural(physics.uses, "time")} over ` +
        `${plural(physics.reinforcedDays ?? 0, "day")} · last used day ${physics.lastUsedDay}`,
    ],
    ["learned on", doc.learnedOn + (doc.happenedOn === undefined ? "" : ` · happened ${doc.happenedOn}`)],
    [
      "standing",
      [
        physics.consolidated ? "consolidated" : "not yet consolidated",
        physics.promotedIdentity ? "promoted into identity" : "not promoted",
        physics.protected ? style.bold("PROTECTED — no revision path reaches it") : "revisable",
      ].join(" · "),
    ],
    [
      "pressure",
      physics.pressure === 0
        ? `${NONE} — nothing has argued with it`
        : `${num(physics.pressure)} standing, last challenged on day ${physics.lastChallengedDay ?? "—"}`,
    ],
  ];
  if (row?.archived === 1) {
    facts.push(["archived", style.warn(row.archived_reason ?? "no reason recorded")]);
  }
  if (headId !== id) {
    facts.push(["you asked for", `${id}, which forwards here`]);
  }

  return stack(
    heading(`${headId}${doc.title === undefined ? "" : ` — ${doc.title}`}`, style),
    indent(table(facts)),
    `${subheading("What it says", style)}\n${indent(doc.body.trimEnd())}`,
    referencesBlock(src, headId, doc.meta, row?.superseded_by ?? null, style),
  );
}

/**
 * Every id this memory points at, resolved NOW. Meta keys are not enumerated
 * blindly: only the ones that are addresses, so a schema's `name` never gets
 * mistaken for a pointer.
 */
function referencesBlock(
  src: DashboardSource,
  id: string,
  meta: Record<string, unknown>,
  supersededBy: string | null,
  style: Style,
): string {
  const store = src.store;
  const rows: string[][] = [];

  if (supersededBy !== null) {
    rows.push(["became", resolveRef(store, supersededBy).label]);
  }
  const entityId = meta["entityId"];
  if (typeof entityId === "string") rows.push(["hangs on", resolveRef(store, entityId).label]);
  const updates = meta["updates"];
  if (typeof updates === "string") rows.push(["revised", resolveRef(store, updates).label]);
  const grounded = meta["groundedIn"];
  if (Array.isArray(grounded)) {
    for (const g of grounded) {
      if (typeof g === "string") rows.push(["grounded in", resolveRef(store, g).label]);
    }
  }
  for (const edge of store.edgesFrom(id)) {
    rows.push([`fires with (${num(edge.weight)})`, resolveRef(store, edge.dst).label]);
  }
  for (const version of store.versions(id)) {
    rows.push([
      `version ${version.seq} (${version.reason}, day ${version.version_day})`,
      version.successor_id === null
        ? "revised in place"
        : resolveRef(store, version.successor_id).label,
    ]);
  }
  for (const p of store.prospectiveFor(id)) {
    rows.push([`looks ahead to ${p.event_date}`, `${p.state}, fired ${plural(p.fires, "time")}`]);
  }

  const heading_ = subheading("What it points at, resolved just now", style);
  if (rows.length === 0) {
    return `${heading_}\n${indent(style.warn(`${NONE} — it points at nothing.`))}`;
  }
  return `${heading_}\n${indent(table(rows))}`;
}
