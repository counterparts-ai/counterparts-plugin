/* What just happened — the durable log, in plain english. A live feed. */
import { $ } from "../../../shared/dom.js";
import { registerLiveFeed, renderFeed } from "../../../shared/widgets/feed.js";

export const markup = `
        <h2>What just happened <small>— the durable log, in plain english</small></h2>
        <div class="card feed" id="flow-feed"></div>`;

export function mount() { registerLiveFeed("flow-feed"); }

export function paint(d) { renderFeed($("flow-feed"), d.feed, d); }
