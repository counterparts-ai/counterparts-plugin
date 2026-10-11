/**
 * THE WAKE IS BEHIND (2026-09-30) — a mark set by the writes that change what
 * the next session should wake to, and read by whichever process with a budget
 * runs next.
 *
 * Until this, the bundle was rendered once per lived day by the sleep cycle, at
 * the day's first worker run, and a page written after that, a write-up that
 * landed, or the nightly run's page reached no wake until the next lived day:
 * on 2026-09-30 the owner's first session of the morning woke with the page
 * from one version back. Now the page write and the write-up set this mark
 * (and, since 2026-10-10, every accepted memory and every handoff change),
 * and the turn-end worker re-renders when it finds it
 * (`Counterpart.refreshWake`); the nightly process re-renders at the run's end
 * without a mark, naming `run-end` as its trigger. Not at SessionStart: the
 * wake ranks nothing and writes nothing (CONTRACT §5 G1).
 *
 * Two meta keys, so a renderer never writes the key a writer sets: `behind` is
 * the mark (`{ n, at, triggers }`), `caught` is the raw mark value the last render
 * read BEFORE it composed. Behind iff the two differ. A mark set while a render
 * is composing has a new value, so it is not swallowed by that render's catch-up.
 *
 * A THIRD KEY, FOR THE BUILD (2026-10-02): `build` is the package version of
 * the process that last published the bundle. After an install the stored wake
 * was still the old version's until something marked it or the next lived day
 * came, so a question the new version closes stayed in "Still open". A
 * process that knows its build (`CounterpartOptions.build`) and finds the
 * stored one different — or absent, a bundle published before this key — treats
 * the wake as behind under the `version` trigger. Nothing writes a mark for it:
 * the comparison is the mark.
 */
import type { Store } from "../store/index.js";

export const WAKE_BEHIND_KEY = "self.wake.behind";
export const WAKE_CAUGHT_KEY = "self.wake.caught";

export const WAKE_BUILD_KEY = "self.wake.build";

/** What made the wake behind: the self page written, a write-up landed, the
 *  nightly run ended, the bundle was published by another build, or a plain
 *  reminder was told on its day (`told`, 2026-10-09) — told, it leaves
 *  "Arriving:", and a wake composed before the telling would still list it
 *  the next morning. Since 2026-10-10, also a memory accepted through any
 *  other door (`memory`: `remember` and its old name `note`, the CLI's
 *  note — whatever reaches `Counterpart.deposit` that is not a write-up)
 *  and a handoff written, retired or cleared (`handoff`). Before, a note
 *  left Still open, Nearby and Arriving stale for up to a day. */
export type WakeTrigger = "page" | "write-up" | "run-end" | "version" | "told" | "memory" | "handoff";

export const WAKE_TRIGGERS: readonly WakeTrigger[] = ["page", "write-up", "run-end", "version", "told", "memory", "handoff"];

/** The mark as it stands, with its raw value — the thing a render records as caught. */
export interface WakeBehind {
  readonly raw: string;
  readonly at: number;
  readonly triggers: readonly WakeTrigger[];
}

function parse(raw: string): { n: number; at: number; triggers: WakeTrigger[] } | null {
  try {
    const v = JSON.parse(raw) as { n?: unknown; at?: unknown; triggers?: unknown };
    const triggers = Array.isArray(v.triggers)
      ? WAKE_TRIGGERS.filter((t) => (v.triggers as unknown[]).includes(t))
      : [];
    return { n: typeof v.n === "number" ? v.n : 0, at: typeof v.at === "number" ? v.at : 0, triggers };
  } catch {
    return null;
  }
}

/** The mark, when the wake is behind it; null when the last render caught up. Never throws. */
export function wakeBehind(store: Store): WakeBehind | null {
  try {
    const raw = store.getMeta(WAKE_BEHIND_KEY);
    if (raw === undefined || raw.length === 0) return null;
    if (store.getMeta(WAKE_CAUGHT_KEY) === raw) return null;
    const v = parse(raw);
    return { raw, at: v?.at ?? 0, triggers: v?.triggers ?? [] };
  } catch {
    return null;
  }
}

/**
 * Set the mark. A mark still pending keeps its triggers and gains this one, so
 * the render that catches up says everything that put it behind. Never throws:
 * a mark that cannot be written costs the early refresh, never the write that
 * set it — the next lived day's render still comes.
 */
export function markWakeBehind(store: Store, trigger: WakeTrigger): void {
  try {
    const pending = wakeBehind(store);
    const triggers = pending === null ? [trigger] : WAKE_TRIGGERS.filter((t) => t === trigger || pending.triggers.includes(t));
    // A count as well as the time, so two marks never read alike — not even
    // under a clock that stands still, which is how most tests run.
    const n = (parse(store.getMeta(WAKE_BEHIND_KEY) ?? "")?.n ?? 0) + 1;
    store.setMeta(WAKE_BEHIND_KEY, JSON.stringify({ n, at: store.now(), triggers }));
  } catch {
    /* the write that set it already landed */
  }
}

/** A render that read `raw` before composing has published: the wake has caught up to it. Never throws. */
export function noteWakeCaught(store: Store, raw: string): void {
  try {
    store.setMeta(WAKE_CAUGHT_KEY, raw);
  } catch {
    /* the mark stays, and the next process with a budget renders again */
  }
}

/**
 * Was the published bundle composed by another build than `build`? False when
 * `build` is unknown (a null is never evidence of a change) or when there is no
 * bundle yet (the first render is the cycle's anyway). An absent stamp beside a
 * bundle is a bundle from before the stamp existed, so it is another build.
 * Never throws.
 */
export function wakeFromOtherBuild(store: Store, briefingKey: string, build: string | null | undefined): boolean {
  if (build === null || build === undefined || build.length === 0) return false;
  try {
    if (store.getMeta(briefingKey) === undefined) return false;
    return store.getMeta(WAKE_BUILD_KEY) !== build;
  } catch {
    return false;
  }
}

/** A render by `build` has published: stamp it. Never throws — an unwritten
 *  stamp costs one more render, never the publish. */
export function noteWakeBuild(store: Store, build: string | null | undefined): void {
  if (build === null || build === undefined || build.length === 0) return;
  try {
    store.setMeta(WAKE_BUILD_KEY, build);
  } catch {
    /* the next process with this build renders once more */
  }
}
