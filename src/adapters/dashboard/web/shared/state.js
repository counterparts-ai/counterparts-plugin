/* The little state more than one module reads. Nothing is cached between
   loads: every panel is a pure function of one JSON view, because the whole
   point of render-time resolution is that a memory removed a minute ago stops
   resolving on the next request. */

/** Which tab is showing, and which have been built once. */
export const tabs = { current: "home", loaded: {} };

/** The pulse's bookkeeping: the newest event seen, and the cheap shape of the
 *  store (`/api/meta`'s rows + day) so a poll can notice a deposit that left no
 *  trace in the event log. `fingerprint` is null until `/api/meta` answers. */
export const live = { lastSeq: 0, fingerprint: null };
