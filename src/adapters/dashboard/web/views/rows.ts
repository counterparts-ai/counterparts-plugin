/**
 * Row shapes and row builders more than one view uses (band bars, contested beliefs,
 * chapters, lived days) — kept apart so no page's view file imports another page's.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { isJournal } from "../../../../core/sleep/index.js";
import type { Band } from "../../../../core/types.js";
import { NONE } from "../../layout.js";
import type { DashboardSource } from "../../source.js";
import { contestedBeliefs } from "../../stories.js";
import { reveal, revealHere } from "../reveal.js";

export interface BarRow {
  readonly label: string;
  readonly count: number;
  readonly fraction: number;
  readonly note: string;
  readonly absent: string | null;
}

export interface ContestedRow {
  readonly id: string;
  readonly headId: string | null;
  readonly about: string;
  /** What it said at its own address, shown around the point it diverges. */
  readonly began: string;
  /** What it says now, shown around the same point. */
  readonly now: string;
  /** Both, whole — for a tooltip and for anyone who wants the sentence. */
  readonly beganFull: string;
  readonly nowFull: string;
  readonly pressure: number;
  readonly bar: number;
  readonly fraction: number;
  readonly revised: boolean;
  readonly challenges: number;
  readonly lastChallengedDay: number | null;
}

export interface ChapterRow {
  readonly id: string;
  readonly title: string;
  readonly day: number;
  readonly bytes: number;
  /** The chapter's opening, in the first person. Never the whole entry. */
  readonly opening: string;
}


export const BAND_GLOSS: Record<Band, string> = {
  episodic: "still an episode; forgettable, and most stay here",
  semantic: "settled into what I know",
  identity: "constitutive — and physics can still move it",
};


/**
 * THE TWO LIVED DAYS — born, and last used.
 *
 * These are the row's metadata now, and the calendar date is not; it has moved
 * to the modal, where there is room to say what it means. The reason is a
 * measurement (design review, 2026-09-04): the identity panel rendered fifteen
 * rows of `learned 2026-09-04` under fifteen rows of `strength 1.00`, so two of
 * the three fields a reader could see never varied, and the panel read as a
 * table of one fact repeated. It was filed as a limitation of the demo store.
 * It was not: `learnedOn` is the day a row ENTERED this store, which in a store
 * built or migrated in one run is the same morning for everything in it, while
 * the lived days are what the physics actually ran on and they spread across
 * the whole month. The more interesting fact was already in the store and the
 * row was showing the other one.
 *
 * `lastUsedDay` is also the one that keeps moving: it is what "this is still
 * load-bearing" looks like as a number.
 */
export function livedDays(src: DashboardSource, id: string): { bornDay: number; lastUsedDay: number } {
  try {
    const physics = src.store.physicsOf(id);
    return { bornDay: physics.birthDay, lastUsedDay: physics.lastUsedDay };
  } catch {
    return { bornDay: 0, lastUsedDay: 0 };
  }
}


export function contestedRows(src: DashboardSource): ContestedRow[] {
  const store = src.store;
  const out: ContestedRow[] = [];
  for (const [rootId] of contestedBeliefs(src)) {
    if (rootId === undefined) continue;
    let story;
    try {
      story = src.schemas.story(rootId);
    } catch {
      continue;
    }
    // UNFOLLOWED for the origin. `reveal` walks the supersede chain, so both
    // ends resolved to the SAME row and the page rendered "it began as X" and
    // "it now says X" as byte-identical strings — the one surface whose whole
    // job is to show a change showed none. The retained prose at the original
    // address is what "it began as" means, and `stories.ts` reads it the same
    // way for the same reason.
    const began = revealHere(store, rootId, FULL);
    const now = reveal(store, story.headId, FULL);
    const [beganShown, nowShown] = divergentPair(
      began.text ?? began.label,
      now.text ?? now.label,
    );
    let about = NONE;
    try {
      const entityId = store.readProse(story.headId).meta["entityId"];
      if (typeof entityId === "string") {
        const r = reveal(store, entityId, 60);
        about = r.text ?? r.label;
      }
    } catch {
      about = NONE;
    }
    out.push({
      id: rootId,
      headId: story.headId,
      about,
      began: beganShown,
      now: nowShown,
      beganFull: began.text ?? began.label,
      nowFull: now.text ?? now.label,
      pressure: story.pressure,
      bar: story.bar,
      fraction: story.bar > 0 ? Math.min(1.4, story.pressure / story.bar) : 0,
      revised: story.headId !== rootId,
      challenges: story.increments.length,
      lastChallengedDay: story.lastChallengedDay,
    });
  }
  return out.sort((a, b) => b.fraction - a.fraction || (a.id < b.id ? -1 : 1));
}

/** Wide enough that a statement is read whole before anything is cut. */
const FULL = 400;

/** `text`, cut to `width`, ending in an ellipsis so a cut is visible as one. */
function clipTo(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1).trimEnd()}…`;
}

/**
 * TWO VERSIONS OF ONE STATEMENT, SHOWN AROUND THE POINT THEY DIVERGE.
 *
 * A revision usually keeps most of its sentence — that is what makes it a
 * revision rather than a new belief — so truncating both from character zero
 * shows the identical prefix twice and cuts the change off the end. The window
 * starts a little before the first character that differs, on a word boundary,
 * with a leading ellipsis when it is not the start of the sentence.
 *
 * Two strings that really are identical come back identical; the caller decides
 * what to say about that (a belief whose successor says the same thing is a
 * fact worth reading, not a bug to hide).
 */
export function divergentPair(a: string, b: string, width = 150): [string, string] {
  if (a === b) return [clipTo(a, width), clipTo(b, width)];
  let i = 0;
  const shared = Math.min(a.length, b.length);
  while (i < shared && a[i] === b[i]) i += 1;
  let start = i;
  while (start > 0 && !/\s/.test(a[start - 1] ?? "")) start -= 1;
  // Enough lead-in that the changed clause has a subject, never so much that
  // the window is spent on text both versions share.
  const lead = Math.min(start, Math.floor(width / 3));
  const from = start - lead;
  const head = from > 0 ? "…" : "";
  return [`${head}${clipTo(a.slice(from), width)}`, `${head}${clipTo(b.slice(from), width)}`];
}

export function chapters(src: DashboardSource, limit: number): ChapterRow[] {
  const store = src.store;
  const out: ChapterRow[] = [];
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || !isJournal(row)) continue;
    try {
      const doc = store.readProse(id);
      const body = doc.body.trim();
      const opening = firstSentences(body, 260);
      out.push({
        id,
        title: doc.title ?? "an unnamed chapter",
        day: doc.bornDay,
        bytes: new TextEncoder().encode(body).length,
        opening,
      });
    } catch {
      out.push({ id, title: reveal(store, id, 60).label, day: 0, bytes: 0, opening: "" });
    }
  }
  return out.sort((a, b) => b.day - a.day || (a.id < b.id ? -1 : 1)).slice(0, limit);
}

/** The first prose of a chapter, bounded. Headings skipped; never the whole entry. */
function firstSentences(body: string, max: number): string {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("<!--"));
  const joined = lines.join(" ");
  return joined.length <= max ? joined : `${joined.slice(0, max).trimEnd()}…`;
}
