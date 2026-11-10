/**
 * THE PAGE'S STORIES (PS1, 2026-11-09; the owner's ask, lightly held):
 * stories about growth, not only corrections.
 *
 * On a page kept in its own form (`writer.ts#PAGE_FORM_KEY`), the stories had
 * all become corrections: the night's writers favoured memories shaped as
 * lessons, and work dominates a day by volume. Five small moves, all words or
 * order, nothing that protects an old story:
 *
 *   1. A MIX OF KINDS, as guidance and not a quota (`PAGE_STORIES_RULE`):
 *      corrections, and what went right, discoveries, moments with the owner.
 *   2. THE SELECTION TEST, in the same words: would it still teach something
 *      in a different project? Work is fine as the setting.
 *   3. A HEAD START for memories about me or us in the order day's end is
 *      shown the day (`PAGE_STORY_LIMITS.HEAD_START`, `writer.ts#dayMemories`).
 *   4. A NOMINATION during the day (`remember` with `story: true`, the tag
 *      `STORY_TAG`): day's end sees it first and still decides; one not taken
 *      is not shown again (day's end reads one day) and fades like any memory.
 *   5. CRAFT MOVES TOWARD SKILL MEMORIES (`PAGE_CRAFT_RULE`): a practice about
 *      the work may be set down into a `kind: skill` memory, which the set-down
 *      record names (`set-down.ts#recordSetDowns`). Nothing is migrated.
 *
 * 1, 2, 3 and 5 are for own-form stores only; 4 is on every store, since the
 * field is offered on every host (a field that did nothing would be a lie).
 * Where each line is said: `writer.ts#writerInstruction` (the nightly block
 * only, beside `SET_DOWN_RULE`; the session-side ask has a ceiling and goes
 * without) and the reflection's page line when it writes the whole page (page
 * split off; split on, it writes Core alone, which tells no stories).
 */
import type { Store } from "../store/index.js";
import { PAGE_STORY_LIMITS as L } from "./tunables.js";

/** The tag a story nomination writes on its memory: the index the night reads. */
export const STORY_TAG = "story nominated";
/** The `via` the nomination's tag is written with. */
export const STORY_TAG_VIA = "story";

/** Items 1 and 2: the mix, and the selection test. Own-form stores, the night's page writers. */
export const PAGE_STORIES_RULE =
  "Where the page tells stories, keep a mix of kinds: corrections that changed how you work, and also what went right, things you discovered, and moments between you and the owner. A page whose stories are only corrections is the failure to avoid; weigh toward the mix, with no count to meet. Keep a story if it would still teach something in a different project: work is fine as its setting when the story is about you, the two of you, or how you treat people.";

/**
 * Item 5: a craft practice may move to a skill memory. `field` is where the
 * writer names a set-down (`setDown` at day's end, `page.setDown` for the
 * reflection).
 */
export function pageCraftRule(field: string): string {
  return `A practice that is only about the work (how to measure, check or build) may leave the page for a skill memory, which recall brings back when the work calls for it: name it in ${field} with why "moved to a skill" and \`skill\`, the practice in a line or two. Move a practice only if it is about the work, not about honesty or about the owner; those stay on the page.`;
}

/** What day's end is told when the day has nominations (said only then). */
export const NOMINATED_NOTE =
  'A line marked "(nominated as a story)" was nominated during the day as a story for the page. Read those first; whether one becomes a story is still yours to decide, and one you pass by fades like any other memory.';

/** The mark a nominated memory's line carries in day's end's block. */
export const NOMINATED_MARK = "(nominated as a story)";

/** The ids nominated as a story (live or not; the caller's list decides what is shown). Never throws. */
export function nominatedIds(store: Pick<Store, "memoriesTagged">): Set<string> {
  try {
    return new Set(store.memoriesTagged(STORY_TAG));
  } catch {
    return new Set();
  }
}

/** Nominate a memory as a story. True when the tag was written now (false: it was already, or would not land). Never throws. */
export function nominateStory(store: Pick<Store, "tagMemory">, memoryId: string): boolean {
  try {
    return store.tagMemory(memoryId, [STORY_TAG], STORY_TAG_VIA) > 0;
  } catch {
    return false;
  }
}

/** The head start a memory gets in day's end's order: `HEAD_START` when it is marked me or us and the store keeps its own form. Pure. */
export function storyHeadStart(about: string | null | undefined, own: boolean): number {
  return own && (about === "me" || about === "us") ? L.HEAD_START : 0;
}
