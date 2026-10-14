import { Counterpart } from "../../core/counterpart.js";
import { zoneBeside } from "../config.js";
import { PLAIN, style as makeStyle } from "./ansi.js";
import { DEFAULT_WIDTH } from "./layout.js";
import { renderActivity } from "./activity.js";
import { renderBrowse } from "./browse.js";
import { renderIdentity } from "./identity.js";
import { renderStatus } from "./status.js";
import { renderStories } from "./stories.js";
import { sourceOf } from "./source.js";

export * from "./ansi.js";
export * from "./layout.js";
export * from "./registries.js";
export * from "./resolve.js";
export * from "./source.js";
export { renderStatus } from "./status.js";
export { DEFAULT_LIMIT, renderBrowse } from "./browse.js";
export { DEFAULT_STORY_LIMIT, PRESSURE_EVENT, contestedBeliefs, renderStories } from "./stories.js";
export { renderIdentity } from "./identity.js";
export { DEFAULT_FEED, renderActivity } from "./activity.js";
export const VIEWS = ["status", "browse", "stories", "identity", "activity"];
export function isViewName(name) {
  return VIEWS.includes(name);
}
export const VIEW_BLURB = {
  status: "the brain at a glance: counts by kind and band, the clock, what the last cycle finished",
  browse: "the memories by strength; open one to see its prose path and everything it points at",
  stories: "per contested belief, the pressure log as a story: day, challenger, force, bar, verdict",
  identity: "the identity band and the protected set, side by side and enumerable",
  activity: "the recent durable events, with every id resolved at render time"
};

export class Dashboard {
  counterpart;
  source;
  style;
  width;
  constructor(opts) {
    const timeZone = opts.timeZone ?? (opts.dir === undefined ? undefined : zoneBeside(opts.dir));
    this.counterpart = Counterpart.open({
      ...opts.dir === undefined ? {} : { dir: opts.dir },
      ...timeZone === undefined ? {} : { timeZone },
      observer: true
    });
    this.source = sourceOf(this.counterpart);
    this.style = opts.colour === true ? makeStyle(true) : PLAIN;
    this.width = opts.width ?? DEFAULT_WIDTH;
  }
  static open(opts = {}) {
    return new Dashboard(opts);
  }
  close() {
    this.counterpart.close();
  }
  get store() {
    return this.counterpart.store;
  }
  get observer() {
    return this.counterpart.observer;
  }
  status(opts = {}) {
    return renderStatus(this.source, { style: this.style, ...opts });
  }
  browse(opts = {}) {
    return renderBrowse(this.source, { style: this.style, ...opts });
  }
  stories(opts = {}) {
    return renderStories(this.source, { style: this.style, ...opts });
  }
  identity(opts = {}) {
    return renderIdentity(this.source, { style: this.style, width: this.width, ...opts });
  }
  activity(opts = {}) {
    return renderActivity(this.source, { style: this.style, ...opts });
  }
  render(view, args = {}) {
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
  all(args = {}) {
    return VIEWS.map((v) => this.render(v, args)).join(`


`);
  }
}
