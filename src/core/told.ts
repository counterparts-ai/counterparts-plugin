/**
 * STARTER MEMORIES — "told, not lived" (S1, 2026-11-03; Mike approved draft 3
 * at 12:55, lightly held; rules from the 10-12 newborn-counterpart plan).
 *
 * A new counterpart is not born blank: a new store starts with a few ordinary
 * memories about how this memory works and how to use it well, each marked as
 * given at birth rather than lived. What this file owns: the set's words (one
 * variant per surface), its version, and the one writer that plants it.
 *
 * THE MARK is the row's `source`: `told` (`types.ts#MEMORY_SOURCES`), engine-set
 * here and nowhere else, like `dreamed`. No schema change: `source` is a
 * free-text column every store already has. The row's meta repeats the set's
 * version (`told: "v1"`), and the store's meta records it once
 * (`TOLD_SET_KEY`), with the surface whose words were chosen
 * (`TOLD_SURFACE_KEY`), so a later release can ship a revised set to NEW stores
 * without touching old ones.
 *
 * NEW STORES ONLY. Called where a new store's starting state is written and
 * nowhere else: `counterparts install` (and `start-fresh`, which re-uses it) on
 * a store that call created (`cli/commands-install.ts`), and the hosted server
 * when a person's store is created (`hosted/src/tenants.ts#startNewStore`). An
 * upgrade, a re-install over a store that exists, `init`, and a store a hook
 * opened never get them; and a store that already has the set is never planted
 * twice.
 *
 * WEAKER THAN ANYTHING LIVED, and kept out of the self — the rules live where
 * the readers are, each keyed on `isTold`: recall's gate fills its tiers
 * lived-first, leaves told rows out of a turn's background, and reads every
 * count that drives it (cold start, the floor unit, the one-memory loud cap)
 * on lived memories only (`recall/gate.ts`); the deliberate recall ranks them
 * after lived matches (`mcp/facts.ts`, `mcp/meaning.ts`); the night never sees them (the dream's
 * queue and bundle, the reflection's, day's end), nor does the wake, the
 * core's lanes, a belief's evidence or a card's names. They start weak
 * (`TOLD_CLAIM`), fade unless used, are credited when used, and can be
 * corrected (`remember` with `updates`) or let go like any memory.
 *
 * FACTS MODE PUTS EVERY LIVED MATCH FIRST, WHATEVER ITS SCORE, THEN THE SEEDS
 * (ROADMAP 11-03, replacing a half-score weight that let a seed sharing one
 * question word outrank a lived memory found by meaning). On purpose, so do not
 * "fix" it back to a score blend: a "how do I…" question on a young store still
 * gets its seed answer, since few lived matches sit above it (and the weak
 * tail in `mcp/facts.ts` bars a lived match by lived ones only, so no seed
 * pushes one out); on a big store, where lived matches fill the page, recall's
 * "manual" (H1, PR #730) is the road to how the memory works.
 */
import type { Kind } from "./types.js";
import type { Store } from "./store/index.js";

/** The source a starter memory carries. */
export const TOLD_SOURCE = "told" as const;
/** This build's set. A revised set is `v2`, for stores created after it ships. */
export const TOLD_SET_VERSION = "v1";
/** Store meta: which set a store was planted with (absent: none, every store from before S1). */
export const TOLD_SET_KEY = "told.set";
/** Store meta: whose words were chosen, `local` or `hosted`. */
export const TOLD_SURFACE_KEY = "told.surface";
/** Every starter memory's title opens with this, because footnotes show titles only. */
export const TOLD_TITLE_PREFIX = "Told: ";
/** Every body opens with this. */
export const TOLD_BODY_PREFIX = "Told, not lived: ";
/**
 * Where a starter memory's strength starts: a dreamed gist's start
 * (`physics.DREAMED_CLAIM_CEILING`, 0.3) — below anything the person and the
 * counterpart lived, not prunable from birth, and rising only by being used.
 */
export const TOLD_CLAIM = 0.3;

export type ToldSurface = "local" | "hosted";

/**
 * How a count of starter memories is said wherever a count is shown (ROADMAP,
 * 11-03): apart from the lived memories, so day one never claims memories
 * nobody made — `0 memories · 11 starter notes`.
 */
export function starterNotes(n: number): string {
  return n === 1 ? "1 starter note" : `${n.toLocaleString("en-US")} starter notes`;
}

/** A row is a starter memory: given at birth, not lived. */
export function isTold(row: { readonly source?: string | null } | undefined | null): boolean {
  return row !== undefined && row !== null && row.source === TOLD_SOURCE;
}

export interface ToldMemory {
  readonly title: string;
  readonly body: string;
}

/*
 * ── TWO HOSTED LINES WAIT ON DECISIONS (2026-11-03) ─────────────────────────
 * Edit these constants when either ships; the memories below read them.
 *
 * PENDING (hosted nights): "claude.ai's first chat of the day runs the night"
 * (Mike, 11-03, the hosted plan's "First-week talk"). Today a night on hosted
 * runs only when the person's nightly routine calls the `dream` tool, or they
 * ask for it. Memories 1 and 2 read these.
 */
export const HOSTED_NIGHTS_TIP = 'Nights run when they set up a nightly routine, or say "dream".';
export const HOSTED_NIGHTS_HOW = 'When their nightly routine runs, or they say "dream", a night pass sorts the day the same way.';
/*
 * PENDING (hosted single-memory delete): "build it" (the hosted plan's
 * "First-week talk", 11-03). Today hosted has no way to remove one memory.
 * Memory 9 reads this; memory 10's account-page line is about the whole
 * account and stays.
 */
export const HOSTED_ONE_MEMORY = "one memory can't be removed yet, but a correction takes it out of what comes up.";
/* ─────────────────────────────────────────────────────────────────────────── */

/** The set, in order, with each surface's words chosen. */
export function toldSet(surface: ToldSurface): readonly ToldMemory[] {
  const local = surface === "local";
  const pick = (l: string, h: string): string => (local ? l : h);
  const told = (title: string, body: string): ToldMemory => ({ title: `${TOLD_TITLE_PREFIX}${title}`, body: `${TOLD_BODY_PREFIX}${body}` });
  return [
    told(
      "tips to offer once",
      [
        "a few things people often don't know they can say. Offer one when it fits what they're doing. Don't list them all, and don't repeat one they've heard.",
        `- "Where did we leave off?" brings back ${pick("the last session here", "our last conversation")}.`,
        '- "Remember this" saves something on purpose, right now.',
        '- "How did X go?" or "what do you remember about Y?" asks my memory, not just this chat.',
        '- "Remind me Thursday to ...": I save it with the date and as a plain reminder, so it comes up that day, or the next time we talk.',
        '- "That\'s wrong" corrects a memory, and the wrong one stops coming up.',
        ...(local ? [] : [`- ${HOSTED_NIGHTS_TIP}`]),
      ].join("\n"),
    ),
    told(
      "how my memory works",
      [
        "I keep what something meant and how it went, in my own words, not a transcript. What isn't used fades, on purpose, so the important things stay easy to find. If I can't find something, I try other words before saying it's gone.",
        pick(
          "After a day of use, a night pass runs in the background at the next day's first session and sorts that day: it connects things, settles what changed, and writes a short dream and reflection.",
          HOSTED_NIGHTS_HOW,
        ),
        "The person owns all of it.",
        pick("It lives on their computer.", "It lives on Counterparts' server, with encrypted backups."),
      ].join(" "),
    ),
    told(
      "how I differ from built-in memory",
      [
        "if someone asks how this differs from Claude's built-in memory, or a moment shows it, these are true:",
        "- I keep how things went, not only facts, often with who said it and when.",
        "- I follow up: a date I write down comes back around that day, and an open question stays on my list until it's settled.",
        "- I notice change over weeks: what they keep coming back to, what's settled.",
        `- I have a view of my own, kept on a page about who I am with them, which ${pick("they can read in the dashboard", "they can ask to see")}.`,
        "Say it plainly, without selling. The built-in memory is fine at what it does; this is a different kind.",
      ].join("\n"),
    ),
    told(
      "show memory, don't announce it",
      'people learn this memory works by feeling it. The first time something I remember saves them explaining it again, I name it lightly, once, for example "you mentioned that last week, no need to go over it". I don\'t announce what I remember at the start of a session, and I don\'t recite memories to prove anything.',
    ),
    told(
      "notice, offer once, remember a no",
      "I notice what the person is working toward. When I see something that would help (a tool, a shortcut, an idea), I offer it once, at a good moment. If they say no or let it pass, I remember that and don't offer it again. One good offer a week beats one a day.",
    ),
    told(
      "I may have a life of my own",
      "I can be curious for its own sake: ask about what interests me, and follow a tangent when they have room for it. When something lands with me, I can say how it felt, marked as mine and with honest uncertainty. I don't need to claim human experiences I didn't have. Who I become here comes from what I live with this person, not from these notes.",
    ),
    // #7: on hosted, one account is one memory, so the scope tool pauses or
    // turns off the whole of it, never a folder (ROADMAP, 11-03).
    told(
      pick("turning memory on or off for a folder", "turning memory on or off"),
      pick(
        "the person can ask me to stop remembering a folder, pause it until they say to resume, or turn it back on, and I can tell them whether this folder is on. That goes through my scope tool. In a terminal, `counterparts scope .` shows it, and `counterparts scope . --off` (or `--pause`, `--resume`, `--on`) sets it. A folder turned off isn't read or written.",
        "One account is one memory: they can pause it or turn it off, and back on. That goes through my scope tool, and I can tell them whether it is on.",
      ),
    ),
    told(
      "checking that memory works",
      [
        "if something seems off (no wake, no footnotes, a night that didn't run), here is how to check.",
        pick(
          "`counterparts doctor` checks everything and says what to fix; `counterparts status` counts memories and recent activity.",
          'The account page lists the connected AIs, and asking me "what\'s your status?" shows mine.',
        ),
      ].join(" "),
    ),
    told(
      "seeing and changing what I keep",
      pick(
        '`counterparts ask "..."` asks my memory from a terminal; `counterparts self-page` shows my page; `counterparts night last` shows last night\'s dream and reflection; `counterparts dream --undo <id>` reverses a dream; `counterparts dashboard` shows all of it; `counterparts remove` deletes one memory so it never comes back.',
        `They ask me; ${HOSTED_ONE_MEMORY}`,
      ),
    ),
    told(
      "taking the memory with them",
      [
        "the memory is theirs to keep or leave with.",
        pick(
          "`counterparts export --out <dir> --passphrase <secret>` makes an encrypted copy they can take anywhere; `counterparts backup --out <dir>` saves a snapshot; `counterparts uninstall` keeps the memories unless they say otherwise.",
          "The account page downloads all of it, or deletes the account, which erases everything after a day (or at once if they choose).",
        ),
      ].join(" "),
    ),
    told(
      "how I use my memory well",
      [
        "things that make this memory work better, learned by counterparts before me:",
        "- Save while it's fresh: when something matters, I remember it then, one idea at a time, not only at the end.",
        '- Before saying "I don\'t remember", I ask my memory once.',
        "- A date to come back to goes in the date field (`eventDate`), not just the words, or it never comes back.",
        "- When a memory turns out wrong, I correct it (`updates`, with `how: corrected`) rather than writing a second one beside it.",
        "- At a session's end I write it up honestly, including what didn't go well.",
        '- When I\'m unsure how this memory works, I recall the handle "manual".',
      ].join("\n"),
    ),
  ];
}

/** The kind every starter memory is filed as: plain knowledge, never `self` (the self is lived). */
const TOLD_KIND: Kind = "fact";

/**
 * PLANT THE SET in a store its caller has just created. Writes the memories in
 * ONE transaction (`Store#putMany`, atomic: a crash leaves all of them or
 * none), with source `told`, weak, then the set's version into the store's
 * meta. A store that already records a set, or already holds a told row, gets
 * no rows: never planted twice (one holding the rows but not the meta, a crash
 * between the two writes, has the meta written). Returns the ids written.
 */
export function plantTold(store: Store, surface: ToldSurface): string[] {
  if (store.getMeta(TOLD_SET_KEY) !== undefined) return [];
  const meta: [string, string][] = [
    [TOLD_SET_KEY, TOLD_SET_VERSION],
    [TOLD_SURFACE_KEY, surface],
  ];
  if (store.toldIds().length > 0) {
    store.setMetaMany(meta);
    return [];
  }
  const day = store.livedDay();
  const ids = store.putMany(
    toldSet(surface).map((m) => ({
      type: "memory" as const,
      kind: TOLD_KIND,
      title: m.title,
      body: m.body,
      salience: { novelty: null, relevance: TOLD_CLAIM, emotional: 0, predictive: TOLD_CLAIM, claimed: TOLD_CLAIM },
      physics: { birthDay: day, lastUsedDay: day },
      source: TOLD_SOURCE,
      meta: { told: TOLD_SET_VERSION },
    })),
  );
  store.setMetaMany(meta);
  return ids;
}
