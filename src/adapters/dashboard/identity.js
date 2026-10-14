import { PLAIN } from "./ansi.js";
import { NONE, columns, heading, indent, meter, num, plural, stack, subheading, table } from "./layout.js";
import { resolveRef } from "./resolve.js";
import { findIdentityCore } from "../../core/self/index.js";
import { DEFAULT_WIDTH } from "./layout.js";
export function renderIdentity(src, opts = {}) {
  const style = opts.style ?? PLAIN;
  const width = opts.width ?? DEFAULT_WIDTH;
  const day = src.store.livedDay();
  const e = src.self.enumerate(day);
  const left = list(src, `Identity band — what strength earned (${e.identity.length})`, e.identity, style, true);
  const right = list(src, `Protected — permanent ink (${e.protected.length})`, e.protected, style, false);
  const both = e.both.length === 0 ? `${style.warn(NONE)} — nothing is both permanent and constitutive.` : e.both.map((id) => resolveRef(src.store, id, 56).label).join(`
`);
  const outside = e.protectedOutsideIdentity.length === 0 ? `${style.warn(NONE)} — every permanent element also stands in the identity band.` : e.protectedOutsideIdentity.map((id) => resolveRef(src.store, id, 56).label).join(`
`);
  const opening = `On day ${day} of use I hold ${plural(e.identity.length, "element")} in the identity band ` + `and ${plural(e.protected.length, "element")} under protection. ` + "The first is what repetition and salience earned and physics can still move; " + "the second is ink no revision path reaches, including a revision that would be right.";
  const core = coreLine(src, style);
  return stack(heading("What I am made of", style), opening, core, columns(left, right, { width }), `${subheading("Both permanent AND constitutive — the strictest class", style)}
${indent(both)}`, `${subheading("Permanent, but outside the identity band", style)}
${indent(outside)}`, unenumerableBlock(src, e.identity, style));
}
function coreLine(src, style) {
  const id = findIdentityCore(src.store);
  if (id === null) {
    return `${style.warn("No identity core yet")} — nothing says who this memory is about. ` + 'Seed one with `counterparts install --name "<you>"` or `counterparts init --name "<you>"`; ' + "there is no default for it anywhere.";
  }
  let name = "(unnamed)";
  let born = null;
  try {
    const doc = src.store.readProse(id);
    const fromMeta = doc.meta["name"];
    name = typeof fromMeta === "string" && fromMeta.length > 0 ? fromMeta : doc.title ?? name;
  } catch {}
  try {
    born = src.store.physicsOf(id).birthDay;
  } catch {
    born = null;
  }
  return `Identity core: seeded as ${name}${born === null ? "" : ` on day ${String(born)}`} (${id}).`;
}
function unenumerableBlock(src, enumerated, style) {
  const seen = new Set(enumerated.map((el) => el.id));
  const missing = src.store.list({ band: "identity", archived: false }).filter((id) => !seen.has(id));
  const heading_ = subheading("Identity-band rows I could not read just now", style);
  if (missing.length === 0) {
    return `${heading_}
${indent(`${style.warn(NONE)} — every element in the band read cleanly.`)}`;
  }
  return `${heading_}
${indent(table(missing.map((id) => [id, resolveRef(src.store, id, 48).label])))}`;
}
function list(src, title, elements, style, showMeter) {
  if (elements.length === 0) {
    return `${subheading(title, style)}
${indent(`${style.warn(NONE)} — this list is empty.`)}`;
  }
  const rows = elements.map((el) => {
    const ref = resolveRef(src.store, el.id, 40);
    const cells = [
      num(el.strength),
      ...showMeter ? [meter(el.strength, 6)] : [],
      el.kind,
      el.band,
      ref.present ? ref.text ?? "" : style.warn(ref.label),
      el.id,
      `${el.bytes}b`
    ];
    return cells;
  });
  return `${subheading(title, style)}
${indent(table(rows, { right: [0] }))}`;
}
