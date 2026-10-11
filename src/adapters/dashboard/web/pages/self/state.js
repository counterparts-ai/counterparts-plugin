/* What is open on the self tab, kept apart from the markup so a live refresh
   can redraw a panel and leave every open thing open. Keyed by stable ids
   (a version's seq, a chapter's row id + number, a lived day), never by a
   position a refresh could shift. */
export const ui = {
  /** The version whose what-changed view is open (its seq); null = none. */
  version: null,
  /** In that view: the whole version rather than the diff. */
  whole: false,
  /** The lived day picked on the page's strip; null = none (round 3b). */
  pageDay: null,
  /** The journal day picked (its lived day); null = follow the newest. */
  day: null,
  /** Expanded chapters, as `<row id>:<chapter number>`. */
  chapters: new Set(),
  /** The wake's full text is showing. */
  wake: false,
  /** Which count's list is open above the chart: "core" | "guarded" | "contested" | null. */
  count: null,
  /** The trait axis whose memories are listed (its id); null = none. */
  trait: null,
};

/** A chapter's key in `ui.chapters`. */
export const chapterKey = (c) => c.id + ":" + c.chapter;
