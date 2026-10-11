/**
 * The web dashboard's JSON views — the same read surface the terminal views use
 * (`DashboardSource`), shaped for a page instead of for a column of text.
 *
 * Four rules travel from the terminal adapter unchanged, and they are the reason
 * this file exists rather than a handful of ad-hoc handlers in the server:
 *
 *   1. **Render-time id resolution, everywhere.** Nothing below emits text that
 *      was stored beside an id. Every id becomes words at the moment the request
 *      is served, through `reveal()` — so a removed memory reads as removed in a
 *      panel built from a three-day-old event (scar §2.20).
 *   2. **Confidential rows are withheld the way every other surface withholds
 *      them** (`reveal.ts`). The row stays visible — id, band, strength, its dot
 *      in the constellation — and only the sentence is gone. A memory the owner
 *      cannot see the existence of would be the worse failure.
 *   3. **Absence has two words.** `(none yet)` — asked, and the answer is zero.
 *      `(never run)` — never asked. Every panel says which; none is blank
 *      (scar §2.4, `NOTES.md`).
 *   4. **Totality.** Kinds, bands, cycle phases and durable event names come
 *      from `registries.ts`, which derives them from the live core. A member
 *      with nothing to report is a row that says so.
 *
 * The journal is excluded from every memory census here, exactly as `status.ts`
 * and `browse.ts` exclude it: an episode is the SOURCE a memory was made from,
 * it sits outside every sleep phase, and counting it would make the census wrong
 * by the number of days lived.
 */
/*
 * This file is now the INDEX of `web/views/`: one module per view (and the
 * shared census and row builders beside them), every public name re-exported
 * here unchanged, so `server.ts` and the tests import exactly what they always
 * did. The four rules above hold for every file in that folder.
 */
export { FEED_LIMIT, census } from "./views/shared.js";
export type { MemoryLine } from "./views/shared.js";
export { metaView } from "./views/meta.js";
export type { MetaView } from "./views/meta.js";
export { divergentPair } from "./views/rows.js";
export type { BarRow, ChapterRow, ContestedRow } from "./views/rows.js";
export { overviewView } from "./views/overview.js";
export type { Hero, OverviewView, Tile } from "./views/overview.js";
export { archiveWords } from "./views/archive-words.js";
export { LIST_MAX, memoriesView, memoryListView } from "./views/memories.js";
export type { KindRow, ListRow, ListState, MemoriesView, MemoryListView } from "./views/memories.js";
export { coreRoad, memoryDetail } from "./views/memory.js";
export type { CoreRoad, MemoryDetail } from "./views/memory.js";
export { searchView } from "./views/search.js";
export type { SearchView } from "./views/search.js";
export { mindView, wakeLanes } from "./views/mind.js";
export type { MindView, StoryBeat, StoryView, WakeLane } from "./views/mind.js";
export { activityView, eventDetail } from "./views/activity.js";
export type { ActivityView } from "./views/activity.js";
export { flowView, nodeDetail } from "./views/flow-view.js";
export type { FlowNodeState, FlowView, NodeDetailView } from "./views/flow-view.js";
export { BLIND_SPOTS, healthView } from "./views/health.js";
export type { HealthView } from "./views/health.js";
export { pulse } from "./views/pulse.js";
export { MECHANISM_PROOFS, mechanismsView } from "./views/mechanisms.js";
export { coreHistory, dreamsView } from "./views/dreams.js";
export { TRAIT_ROWS_MAX, WEEK_AGO_DAYS, balanceOf, firmnessThen, traitsView } from "./views/traits.js";
export type { TraitAxisView, TraitNudgeRow, TraitsView, WeighedNudge } from "./views/traits.js";
export type { CoreHistory, CoreHistoryRow, DreamChangeView, DreamView, DreamsView } from "./views/dreams.js";
export type { MechanismLight, MechanismsView } from "./views/mechanisms.js";
export { mechanismPanel } from "./views/mechanism-panel.js";
export type { MechanismPanelView, Picture } from "./views/mechanism-panel.js";
export { num } from "../layout.js";
