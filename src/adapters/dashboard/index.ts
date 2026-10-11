/**
 * `adapters/dashboard/` — the owner's window.
 *
 * The direct instrument of constitution line 16: *if the owner can't see it, it
 * isn't trustworthy.* Five views, minimal-first (Amendment 15, CONTRACT §4):
 *
 *   `status`    the brain at a glance — counts by kind and band, the clock, what
 *               the last cycle finished, what has left and how.
 *   `browse`    the memories, listed by strength; one memory opened shows its
 *               prose PATH and resolves every id it points at, at render time.
 *   `stories`   per contested belief, the durable pressure log told as a story:
 *               lived day, challenger, force, bar, verdict.
 *   `identity`  the identity band and the protected set, side by side, enumerable
 *               on demand (scar §2.19).
 *   `activity`  the recent event feed, content-by-reference resolved at render.
 *
 * ## Observer BY CONSTRUCTION
 *
 * `Dashboard.open` composes a `Counterpart` — the composition root, never a
 * hand-rewired Store, because re-deriving the wiring is how a caller "forgets the
 * map and silently loses the safety half that rides along with it" — and it sets
 * `observer: true` ITSELF. The caller cannot turn it off: an `observer: false` in
 * the options is overwritten, not honoured. `sourceOf()` then refuses any
 * Counterpart whose stance is not observer, so the views cannot be handed a
 * writable brain even by a caller composing them directly.
 *
 * That is two layers. The third and load-bearing one is in the test: it scans
 * every source file in this directory with comments and string literals stripped
 * and fails on any call to a `WRITE_METHODS` name or any filesystem write. That
 * scan is what "holds no write handle" actually means here, and it is also the
 * mechanization of "no memory body text is persisted into dashboard state" — the
 * dashboard has no state file because it cannot open one.
 *
 * `budgetBytes` and `identity` are deliberately never passed through: the
 * dashboard does not wake and does not mint an identity core. An instrument
 * leaves the store as it found it (scar E7).
 *
 * ## Terminal-first
 *
 * CONTRACT OQ1 asked terminal or local web. Terminal, for now — see `NOTES.md`;
 * it is a working default, revisable without ceremony, and nothing in the view
 * functions knows it: they return strings.
 */
import { Counterpart } from "../../core/counterpart.js";
import { zoneBeside } from "../config.js";
import { PLAIN, style as makeStyle } from "./ansi.js";
import type { Style } from "./ansi.js";
import { DEFAULT_WIDTH } from "./layout.js";
import { renderActivity } from "./activity.js";
import type { ActivityOptions } from "./activity.js";
import { renderBrowse } from "./browse.js";
import type { BrowseOptions } from "./browse.js";
import { renderIdentity } from "./identity.js";
import type { IdentityOptions } from "./identity.js";
import { renderStatus } from "./status.js";
import type { StatusOptions } from "./status.js";
import { renderStories } from "./stories.js";
import type { StoriesOptions } from "./stories.js";
import { sourceOf } from "./source.js";
import type { DashboardSource } from "./source.js";

export * from "./ansi.js";
export * from "./layout.js";
export * from "./registries.js";
export * from "./resolve.js";
export * from "./source.js";
export { renderStatus } from "./status.js";
export type { StatusOptions } from "./status.js";
export { DEFAULT_LIMIT, renderBrowse } from "./browse.js";
export type { BrowseOptions } from "./browse.js";
export { DEFAULT_STORY_LIMIT, PRESSURE_EVENT, contestedBeliefs, renderStories } from "./stories.js";
export type { StoriesOptions } from "./stories.js";
export { renderIdentity } from "./identity.js";
export type { IdentityOptions } from "./identity.js";
export { DEFAULT_FEED, renderActivity } from "./activity.js";
export type { ActivityOptions } from "./activity.js";

/** The five. A sixth is earned by the owner asking for it (CONTRACT §4). */
export const VIEWS = ["status", "browse", "stories", "identity", "activity"] as const;
export type ViewName = (typeof VIEWS)[number];

export function isViewName(name: string): name is ViewName {
  return (VIEWS as readonly string[]).includes(name);
}

/** One line each, for the entry script's help and for the owner's memory. */
export const VIEW_BLURB: Record<ViewName, string> = {
  status: "the brain at a glance: counts by kind and band, the clock, what the last cycle finished",
  browse: "the memories by strength; open one to see its prose path and everything it points at",
  stories: "per contested belief, the pressure log as a story: day, challenger, force, bar, verdict",
  identity: "the identity band and the protected set, side by side and enumerable",
  activity: "the recent durable events, with every id resolved at render time",
};

export interface ViewArgs
  extends StatusOptions,
    BrowseOptions,
    StoriesOptions,
    IdentityOptions,
    ActivityOptions {}

export interface DashboardOptions {
  /** The data dir to look at. Defaults to `dataDir()`, resolved at call time. */
  readonly dir?: string;
  /** Escapes off unless asked. Views are byte-stable without one. */
  readonly colour?: boolean;
  readonly width?: number;
  /**
   * The person's zone, an IANA name: the host configuration's `timeZone`, the
   * one the hooks and the MCP server date days in (docs/time.md). Left out,
   * the configuration beside `dir` is read for it (`config.ts#zoneBeside`);
   * none there, the machine's zone. Every date a view prints is read in it
   * (`store.zone()`), so one page never shows two days for one moment
   * (review of #335, 2026-10-09).
   */
  readonly timeZone?: string;
}

export class Dashboard {
  readonly counterpart: Counterpart;
  readonly source: DashboardSource;
  readonly style: Style;
  readonly width: number;

  private constructor(opts: DashboardOptions) {
    // Read beside a NAMED dir only: resolving the default here would be a
    // second place that can refuse before the store's own refusal says why.
    const timeZone = opts.timeZone ?? (opts.dir === undefined ? undefined : zoneBeside(opts.dir));
    this.counterpart = Counterpart.open({
      ...(opts.dir === undefined ? {} : { dir: opts.dir }),
      ...(timeZone === undefined ? {} : { timeZone }),
      // NOT spread from the caller, and NOT defaulted: set here, unconditionally.
      observer: true,
    });
    this.source = sourceOf(this.counterpart);
    this.style = opts.colour === true ? makeStyle(true) : PLAIN;
    this.width = opts.width ?? DEFAULT_WIDTH;
  }

  static open(opts: DashboardOptions = {}): Dashboard {
    return new Dashboard(opts);
  }

  close(): void {
    this.counterpart.close();
  }

  /** The store this is reading. Exposed so a caller can assert the stance. */
  get store(): Counterpart["store"] {
    return this.counterpart.store;
  }

  get observer(): boolean {
    return this.counterpart.observer;
  }

  status(opts: StatusOptions = {}): string {
    return renderStatus(this.source, { style: this.style, ...opts });
  }

  browse(opts: BrowseOptions = {}): string {
    return renderBrowse(this.source, { style: this.style, ...opts });
  }

  stories(opts: StoriesOptions = {}): string {
    return renderStories(this.source, { style: this.style, ...opts });
  }

  identity(opts: IdentityOptions = {}): string {
    return renderIdentity(this.source, { style: this.style, width: this.width, ...opts });
  }

  activity(opts: ActivityOptions = {}): string {
    return renderActivity(this.source, { style: this.style, ...opts });
  }

  /** Dispatch by name — what `bin/` and any future host call. */
  render(view: ViewName, args: ViewArgs = {}): string {
    switch (view) {
      case "status":
        return this.status(args);
      case "browse":
        return this.browse(args);
      case "stories":
        return this.stories(args);
      case "identity":
        return this.identity(args);
      case "activity":
        return this.activity(args);
    }
  }

  /** Every view, in order. The whole window, for a scroll-back or a paste. */
  all(args: ViewArgs = {}): string {
    return VIEWS.map((v) => this.render(v, args)).join("\n\n\n");
  }
}
