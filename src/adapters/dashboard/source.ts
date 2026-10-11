/**
 * The dashboard's READ SURFACE, named in one place.
 *
 * Every view takes a `DashboardSource` rather than a `Counterpart`, for one
 * reason: this interface is the complete list of what an instrument touches, so
 * "what could the dashboard possibly reach?" is answerable by reading nine lines
 * instead of auditing five view files. The stance travels with it — a source is
 * constructed only from a Counterpart that is already in observer mode, and
 * `sourceOf` refuses otherwise (CONTRACT §5 [M]: observer BY CONSTRUCTION, not
 * by the store standing down at the last moment; `docs/observer-mode.md` G4).
 *
 * This is NOT a defensive wrapper. The three modules below are the real objects
 * and their write methods are still on them; the enforcement that matters is the
 * refusal here plus the source scan in `test/dashboard.test.ts`, which fails on
 * any `WRITE_METHOD` call or filesystem write appearing anywhere in this
 * directory. Types are documentation; the scan is the mechanism.
 *
 * Since 2026-09-24 the store half is also a TYPE: `store` is a `ReadOnlyStore`
 * (the core's `Store` minus every `WRITE_METHODS` name, `close` and
 * `guardWrites`), so a view that names a write method on it fails `tsc`
 * (INTERFACE-GAPS §4). `schemas` and `self` are still the real objects, so the
 * scan stays — it is what covers them, and a cast.
 */
import type { Counterpart } from "../../core/counterpart.js";
import type { Schemas } from "../../core/schemas/index.js";
import type { Self } from "../../core/self/index.js";
import type { ReadOnlyStore } from "../../core/store/index.js";

export interface DashboardSource {
  readonly store: ReadOnlyStore;
  readonly schemas: Schemas;
  readonly self: Self;
  /** Always true. A false one never gets built. */
  readonly observer: boolean;
}

export class ObserverRequired extends Error {
  constructor() {
    super(
      "the dashboard reads only in observer mode — open the Counterpart with { observer: true }",
    );
    this.name = "ObserverRequired";
  }
}

export function sourceOf(counterpart: Counterpart): DashboardSource {
  if (!counterpart.observer || !counterpart.store.observer) throw new ObserverRequired();
  return {
    store: counterpart.store,
    schemas: counterpart.schemas,
    self: counterpart.self,
    observer: true,
  };
}
