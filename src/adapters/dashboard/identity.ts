/**
 * `identity` — the identity band and the protected set, SIDE BY SIDE.
 *
 * The keep (CONTRACT §3, review finding 2; scar §2.19): *inspectability scales
 * with permanence.* Everything permanent is enumerable on demand — a list, not a
 * cadence — and this view is the demand.
 *
 * The two lists are different populations and the difference is the whole point
 * (`self/identity.ts` says it best): identity is what strength EARNED and physics
 * can still move; protected is permanent ink no revision path reaches and no
 * schema slice will ever contradict. "Permanent-includes-permanently-wrong" is
 * doctrine, so a protected element that is NOT in the identity band — permanence
 * without the band — is the row most worth staring at, and it gets its own line.
 *
 * The enumeration itself is `self/`'s, not a second implementation. Reads there
 * are pure: they write nothing and log nothing (§14.1 G8).
 */
import { PLAIN } from "./ansi.js";
import type { Style } from "./ansi.js";
import { NONE, columns, heading, indent, meter, num, plural, stack, subheading, table } from "./layout.js";
import { resolveRef } from "./resolve.js";
import type { DashboardSource } from "./source.js";
import { findIdentityCore } from "../../core/self/index.js";
import type { EnumeratedElement } from "../../core/self/index.js";
import { DEFAULT_WIDTH } from "./layout.js";

export interface IdentityOptions {
  readonly style?: Style;
  readonly width?: number;
}

export function renderIdentity(src: DashboardSource, opts: IdentityOptions = {}): string {
  const style = opts.style ?? PLAIN;
  const width = opts.width ?? DEFAULT_WIDTH;
  const day = src.store.livedDay();
  const e = src.self.enumerate(day);

  const left = list(
    src,
    `Identity band — what strength earned (${e.identity.length})`,
    e.identity,
    style,
    true,
  );
  const right = list(
    src,
    `Protected — permanent ink (${e.protected.length})`,
    e.protected,
    style,
    false,
  );

  const both =
    e.both.length === 0
      ? `${style.warn(NONE)} — nothing is both permanent and constitutive.`
      : e.both.map((id) => resolveRef(src.store, id, 56).label).join("\n");

  const outside =
    e.protectedOutsideIdentity.length === 0
      ? `${style.warn(NONE)} — every permanent element also stands in the identity band.`
      : e.protectedOutsideIdentity.map((id) => resolveRef(src.store, id, 56).label).join("\n");

  const opening =
    `On lived day ${day} I hold ${plural(e.identity.length, "element")} in the identity band ` +
    `and ${plural(e.protected.length, "element")} under protection. ` +
    "The first is what repetition and salience earned and physics can still move; " +
    "the second is ink no revision path reaches, including a revision that would be right.";

  // THE CORE ITSELF, named or absent. Until 2026-09-04 this view rendered
  // identically for a store whose identity core had been seeded and one whose
  // had not — both show an empty band on day 0 — so a stranger who ran `init`
  // instead of `install` had no way to find out that the thing the memory is
  // ABOUT did not exist. The read is `self/`'s own finder plus one prose read,
  // and it writes nothing (§14.1 G8).
  const core = coreLine(src, style);

  return stack(
    heading("What I am made of", style),
    opening,
    core,
    columns(left, right, { width }),
    `${subheading("Both permanent AND constitutive — the strictest class", style)}\n${indent(both)}`,
    `${subheading("Permanent, but outside the identity band", style)}\n${indent(outside)}`,
    unenumerableBlock(src, e.identity, style),
  );
}

/**
 * One line naming the identity core, or its absence.
 *
 * The core is a `schema`/`self` row carrying `role: "entity"` in its meta
 * (`self/identity.ts#findIdentityCore`), minted by `ensureIdentityCore` from a
 * name the owner supplied — `install --name`, `init --name`, or `identity.name`
 * in the host config. There is no default for it anywhere, which is exactly why
 * its absence has to be legible rather than inferred from an empty band.
 */
function coreLine(src: DashboardSource, style: Style): string {
  const id = findIdentityCore(src.store);
  if (id === null) {
    return (
      `${style.warn("No identity core yet")} — nothing says who this memory is about. ` +
      'Seed one with `counterparts install --name "<you>"` or `counterparts init --name "<you>"`; ' +
      "there is no default for it anywhere."
    );
  }
  let name = "(unnamed)";
  let born: number | null = null;
  try {
    const doc = src.store.readProse(id);
    const fromMeta = doc.meta["name"];
    name = typeof fromMeta === "string" && fromMeta.length > 0 ? fromMeta : (doc.title ?? name);
  } catch {
    /* a core whose prose has gone is still a core; the id below says so */
  }
  try {
    born = src.store.physicsOf(id).birthDay;
  } catch {
    born = null;
  }
  return `Identity core: seeded as ${name}${born === null ? "" : ` on day ${String(born)}`} (${id}).`;
}

/**
 * Identity-band rows the enumeration could NOT read — a memory the owner removed
 * since, or prose that has gone.
 *
 * `self/enumerate` drops such a row silently (`enumerateOne` returns null on a
 * throw), which is right for a briefing and wrong for an inspection surface:
 * scar §2.19 says everything permanent is enumerable ON DEMAND, and a row that
 * quietly stops being counted is indistinguishable from one that was never
 * there. The band is queryable, so the gap is recoverable here — the difference
 * between the band's rows and the enumeration's is printed as named absences.
 *
 * The protected SET has no such recovery: protection is a physics flag on a row
 * whose physics is exactly what stopped reading, so a removed protected element
 * simply leaves the list. Filed in `INTERFACE-GAPS.md` §3.
 */
function unenumerableBlock(
  src: DashboardSource,
  enumerated: readonly EnumeratedElement[],
  style: Style,
): string {
  const seen = new Set(enumerated.map((el) => el.id));
  const missing = src.store
    .list({ band: "identity", archived: false })
    .filter((id) => !seen.has(id));
  const heading_ = subheading("Identity-band rows I could not read just now", style);
  if (missing.length === 0) {
    return `${heading_}\n${indent(`${style.warn(NONE)} — every element in the band read cleanly.`)}`;
  }
  return `${heading_}\n${indent(
    table(missing.map((id) => [id, resolveRef(src.store, id, 48).label])),
  )}`;
}

function list(
  src: DashboardSource,
  title: string,
  elements: readonly EnumeratedElement[],
  style: Style,
  showMeter: boolean,
): string {
  if (elements.length === 0) {
    return `${subheading(title, style)}\n${indent(`${style.warn(NONE)} — this list is empty.`)}`;
  }
  const rows = elements.map((el) => {
    // Text at render time: the enumeration carries a title, but a title is not
    // the memory, and an element removed since enumeration must stop resolving.
    const ref = resolveRef(src.store, el.id, 40);
    const cells = [
      num(el.strength),
      ...(showMeter ? [meter(el.strength, 6)] : []),
      el.kind,
      el.band,
      ref.present ? (ref.text ?? "") : style.warn(ref.label),
      el.id,
      `${el.bytes}b`,
    ];
    return cells;
  });
  return `${subheading(title, style)}\n${indent(table(rows, { right: [0] }))}`;
}
