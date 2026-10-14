import { band, rep, sal, strength } from "../../core/physics/index.js";
import { isJournal } from "../../core/sleep/index.js";
import { PLAIN } from "./ansi.js";
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
  truncate
} from "./layout.js";
import { gistOf, resolveRef } from "./resolve.js";
export const DEFAULT_LIMIT = 20;
export function renderBrowse(src, opts = {}) {
  return opts.id === undefined ? renderList(src, opts) : renderOne(src, opts.id, opts);
}
function renderList(src, opts) {
  const style = opts.style ?? PLAIN;
  const store = src.store;
  const day = store.livedDay();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const filter = {};
  if (opts.kind !== undefined)
    filter.kind = opts.kind;
  if (opts.archived !== true)
    filter.archived = false;
  const lines = [];
  for (const id of store.list(filter)) {
    const row = store.row(id);
    if (row === undefined)
      continue;
    if (isJournal(row))
      continue;
    let gist;
    let s;
    let b;
    try {
      const physics = store.physicsOf(id);
      gist = gistOf(store.readProse(id));
      s = strength(physics, day);
      b = band(physics, day);
    } catch {
      if (opts.band !== undefined && row.band !== opts.band)
        continue;
      lines.push({
        id,
        strength: 0,
        band: row.band,
        kind: row.kind,
        gist: resolveRef(store, id).label,
        archived: row.archived_reason
      });
      continue;
    }
    if (opts.band !== undefined && b !== opts.band)
      continue;
    lines.push({
      id,
      strength: s,
      band: b,
      kind: row.kind,
      gist,
      archived: row.archived === 1 ? row.archived_reason ?? "archived" : null
    });
  }
  lines.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  const shown = lines.slice(0, limit);
  const filterNote = [
    opts.band === undefined ? null : `band ${opts.band}`,
    opts.kind === undefined ? null : `kind ${opts.kind}`,
    opts.archived === true ? "archived included" : "live only"
  ].filter((x) => x !== null).join(", ");
  if (shown.length === 0) {
    return stack(heading("The memories I hold", style), style.warn(`${NONE} — nothing matches (${filterNote}).`));
  }
  const rows = [["strength", "", "band", "kind", "what it says", "id"]];
  for (const line of shown) {
    rows.push([
      num(line.strength),
      meter(line.strength, 8),
      line.band,
      line.kind,
      truncate(line.gist, 48) + (line.archived === null ? "" : style.dim(` (${line.archived})`)),
      line.id
    ]);
  }
  const footer = `${plural(lines.length, "memory", "memories")} match ${filterNote}; showing ${shown.length}, strongest first. ` + "Open one with `browse --id <id>`.";
  return stack(heading("The memories I hold", style), indent(table(rows, { right: [0] })), footer);
}
function renderOne(src, id, opts) {
  const style = opts.style ?? PLAIN;
  const store = src.store;
  const day = store.livedDay();
  const ref = resolveRef(store, id);
  if (!ref.present || ref.headId === null) {
    return stack(heading(`Memory ${id}`, style), style.warn(ref.label));
  }
  const headId = ref.headId;
  const doc = store.readProse(headId);
  const row = store.row(headId);
  const physics = store.physicsOf(headId);
  const facts = [
    [
      "record",
      row === undefined ? "—" : `${headId} · rev ${row.revision} · ${row.content_hash === "" ? "—" : row.content_hash}`
    ],
    ["kind", physics.kind],
    ["band", `${band(physics, day)} (recorded ${row?.band ?? "—"}, set day ${row?.band_day ?? "—"})`],
    [
      "strength",
      `${num(strength(physics, day))}  ${meter(strength(physics, day), 12)}` + `   salience ${num(sal(physics.salience))} · repetition ${num(rep(physics))}`
    ],
    [
      "salience",
      `relevance ${num(physics.salience.relevance)} · emotional ${num(physics.salience.emotional)} · ` + `predictive ${num(physics.salience.predictive)} · ` + (physics.salience.novelty === null ? style.warn("novelty blind (no schema context existed)") : `novelty ${num(physics.salience.novelty)}`) + (physics.salience.claimed === null || physics.salience.claimed === undefined ? "" : ` · claimed floor ${num(physics.salience.claimed)}`)
    ],
    [
      "use",
      `born day ${physics.birthDay} · used ${plural(physics.uses, "time")} over ` + `${plural(physics.reinforcedDays ?? 0, "day")} · last used day ${physics.lastUsedDay}`
    ],
    ["learned on", doc.learnedOn + (doc.happenedOn === undefined ? "" : ` · happened ${doc.happenedOn}`)],
    [
      "standing",
      [
        physics.consolidated ? "consolidated" : "not yet consolidated",
        physics.promotedIdentity ? "promoted into identity" : "not promoted",
        physics.protected ? style.bold("PROTECTED — no revision path reaches it") : "revisable"
      ].join(" · ")
    ],
    [
      "pressure",
      physics.pressure === 0 ? `${NONE} — nothing has argued with it` : `${num(physics.pressure)} standing, last challenged on day ${physics.lastChallengedDay ?? "—"}`
    ]
  ];
  if (row?.archived === 1) {
    facts.push(["archived", style.warn(row.archived_reason ?? "no reason recorded")]);
  }
  if (headId !== id) {
    facts.push(["you asked for", `${id}, which forwards here`]);
  }
  return stack(heading(`${headId}${doc.title === undefined ? "" : ` — ${doc.title}`}`, style), indent(table(facts)), `${subheading("What it says", style)}
${indent(doc.body.trimEnd())}`, referencesBlock(src, headId, doc.meta, row?.superseded_by ?? null, style));
}
function referencesBlock(src, id, meta, supersededBy, style) {
  const store = src.store;
  const rows = [];
  if (supersededBy !== null) {
    rows.push(["became", resolveRef(store, supersededBy).label]);
  }
  const entityId = meta["entityId"];
  if (typeof entityId === "string")
    rows.push(["hangs on", resolveRef(store, entityId).label]);
  const updates = meta["updates"];
  if (typeof updates === "string")
    rows.push(["revised", resolveRef(store, updates).label]);
  const grounded = meta["groundedIn"];
  if (Array.isArray(grounded)) {
    for (const g of grounded) {
      if (typeof g === "string")
        rows.push(["grounded in", resolveRef(store, g).label]);
    }
  }
  for (const edge of store.edgesFrom(id)) {
    rows.push([`fires with (${num(edge.weight)})`, resolveRef(store, edge.dst).label]);
  }
  for (const version of store.versions(id)) {
    rows.push([
      `version ${version.seq} (${version.reason}, day ${version.version_day})`,
      version.successor_id === null ? "revised in place" : resolveRef(store, version.successor_id).label
    ]);
  }
  for (const p of store.prospectiveFor(id)) {
    rows.push([`looks ahead to ${p.event_date}`, `${p.state}, fired ${plural(p.fires, "time")}`]);
  }
  const heading_ = subheading("What it points at, resolved just now", style);
  if (rows.length === 0) {
    return `${heading_}
${indent(style.warn(`${NONE} — it points at nothing.`))}`;
  }
  return `${heading_}
${indent(table(rows))}`;
}
