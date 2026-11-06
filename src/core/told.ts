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
 * version (`told: "v2"`), and the store's meta records it once
 * (`TOLD_SET_KEY`), with the surface whose words were chosen
 * (`TOLD_SURFACE_KEY`), so a later release can ship a revised set to new stores
 * and decide, row by row, what an old store gets.
 *
 * NEW STORES ONLY, for the plant. Called where a new store's starting state is
 * written and nowhere else: `counterparts install` (and `start-fresh`, which
 * re-uses it) on a store that call created (`cli/commands-install.ts`), and the
 * hosted server when a person's store is created
 * (`hosted/src/tenants.ts#startNewStore`). An upgrade, a re-install over a store
 * that exists, `init`, and a store a hook opened never get them; and a store
 * that already has the set is never planted twice.
 *
 * ONE REVISION OF AN OLD SET (v1 → v2, HD1, 2026-11-04; Mike yes via ROADMAP
 * 10:50): `reviseTold` rewrites, once per store, the starter memories whose
 * words the new set changed (#1's "Delete that" tip, #9's chat delete, and on
 * hosted #2, whose nights line HN1 rewrote: coordinator 11-04 18:02), and
 * ONLY where the row is still the words it was planted with — still told,
 * live, title and body exactly v1's. One the person corrected, let go, or a
 * night rewrote is theirs and stays. Run from every writable open
 * (`Counterpart`'s constructor), never under observer; once the store's meta
 * says `v2` it costs one meta read.
 *
 * AND A CHANGE OF SURFACE (EX1, 2026-11-04): the same pass, the same
 * safeguard, when a door that names its surface (`Counterpart.open`'s
 * `toldSurface`) opens a store planted in the other one's words — a hosted
 * "Download my memory" file put in place of a local store. Unchanged starters
 * read as the opening surface's; edited ones stay. The worker names none.
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
/**
 * This build's set. `v1` was S1's (0.3.46); `v2` (HD1) changed #1 and #9, and
 * on hosted #2 (HN1's nights line), and `reviseTold` brings a v1 store's
 * unchanged copies of those to it.
 */
export const TOLD_SET_VERSION = "v2";
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
 * SHIPPED (hosted nights, HN1 2026-11-04): "claude.ai's first chat of the day
 * runs the night" (Mike, 11-03, the hosted plan's "First-week talk"), then
 * answers (night first, 11-04); "ask first" makes it ask. A nightly routine still runs it, if
 * they set one up. Memories 1 and 2 read these.
 */
export const HOSTED_NIGHTS_TIP = '"Ask first" has me ask before I sort yesterday\'s memories in our first chat of the day; "no dreams" turns the nights off.';
export const HOSTED_NIGHTS_HOW = "After a day of use, the next day's first chat runs a night pass before I answer: it sorts that day, connects things, settles what changed, and writes a short dream and reflection. A nightly routine they set up runs it instead, when it comes first.";
/*
 * SHIPPED (HD1, 2026-11-04): one memory is deleted from chat, held 24 hours
 * for an undo, then erased (`core/removal-hold.ts`). Memory 9 reads this on
 * hosted; memory 10's account-page line is about the whole account and stays.
 */
export const HOSTED_ONE_MEMORY = "They can ask me to delete one memory, and undo it within a day.";
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
        '- "Delete that" removes one memory; "undo that" brings it back within a day.',
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
        '`counterparts ask "..."` asks my memory from a terminal; `counterparts self-page` shows my page; `counterparts night last` shows last night\'s dream and reflection; `counterparts dream --undo <id>` reverses a dream; `counterparts dashboard` shows all of it; `counterparts remove` deletes one memory so it never comes back. They can also ask me to delete one, with a day to undo it.',
        `They ask me. ${HOSTED_ONE_MEMORY}`,
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
    // Which set those rows are is not known (a v1 plant crashed as well as a
    // v2 one could), so they are recorded as v1 and the revision settles it:
    // a v1 row still in its words is brought to v2, anything else is left.
    store.setMetaMany([[TOLD_SET_KEY, TOLD_SET_V1], [TOLD_SURFACE_KEY, surface]]);
    reviseTold(store);
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

// ── v1 → v2: the one revision of an old set ─────────────────────────────────

/** The set S1 shipped (0.3.46): what a store's meta says until `reviseTold` has run. */
export const TOLD_SET_V1 = "v1";

/*
 * THE v1 WORDS, FROZEN (from `git show 7abd940e:src/core/told.ts`, the same
 * as v0.3.46's): written out here, never built from today's constants, so a
 * later edit to a tip or to `HOSTED_NIGHTS_TIP` cannot move what "unchanged
 * since v1" means. #1 also has the words master planted for two hours on
 * 11-03 (S1 before its round 2, never released), with the shorter reminder
 * tip; a store made then is just as unchanged.
 */
const V1_TIPS_OPEN = "Told, not lived: a few things people often don't know they can say. Offer one when it fits what they're doing. Don't list them all, and don't repeat one they've heard.";
const V1_TIPS_ASK = [
  '- "Remember this" saves something on purpose, right now.',
  '- "How did X go?" or "what do you remember about Y?" asks my memory, not just this chat.',
];
const V1_TIPS_REMIND = '- "Remind me Thursday to ...": I save it with the date and as a plain reminder, so it comes up that day, or the next time we talk.';
const V1_TIPS_REMIND_EARLY = '- "Remind me Thursday to ..." comes up that day, or the next time we talk.';
const V1_TIPS_WRONG = '- "That\'s wrong" corrects a memory, and the wrong one stops coming up.';
const V1_TIPS_NIGHTS_HOSTED = '- Nights run when they set up a nightly routine, or say "dream".';
/* #2 on hosted, as 0.3.46 planted it (its nights sentence is v1's HOSTED_NIGHTS_HOW); local's #2 is unchanged in v2. */
const V1_HOW_HOSTED = [
  "Told, not lived: I keep what something meant and how it went, in my own words, not a transcript. What isn't used fades, on purpose, so the important things stay easy to find. If I can't find something, I try other words before saying it's gone.",
  'When their nightly routine runs, or they say "dream", a night pass sorts the day the same way.',
  "The person owns all of it.",
  "It lives on Counterparts' server, with encrypted backups.",
].join(" ");

function v1Tips(surface: ToldSurface, remind: string): string {
  const local = surface === "local";
  return [
    V1_TIPS_OPEN,
    `- "Where did we leave off?" brings back ${local ? "the last session here" : "our last conversation"}.`,
    ...V1_TIPS_ASK,
    remind,
    V1_TIPS_WRONG,
    ...(local ? [] : [V1_TIPS_NIGHTS_HOSTED]),
  ].join("\n");
}

/** The starter memories v2 changed on this surface, each by its title, with every body that counts as its v1 words. */
export function toldV1Words(surface: ToldSurface): readonly { readonly title: string; readonly bodies: readonly string[] }[] {
  return [
    {
      title: "Told: tips to offer once",
      bodies: [v1Tips(surface, V1_TIPS_REMIND), v1Tips(surface, V1_TIPS_REMIND_EARLY)],
    },
    ...(surface === "local" ? [] : [{ title: "Told: how my memory works", bodies: [V1_HOW_HOSTED] }]),
    {
      title: "Told: seeing and changing what I keep",
      bodies: [
        surface === "local"
          ? "Told, not lived: `counterparts ask \"...\"` asks my memory from a terminal; `counterparts self-page` shows my page; `counterparts night last` shows last night's dream and reflection; `counterparts dream --undo <id>` reverses a dream; `counterparts dashboard` shows all of it; `counterparts remove` deletes one memory so it never comes back."
          : "Told, not lived: They ask me; one memory can't be removed yet, but a correction takes it out of what comes up.",
      ],
    },
  ];
}

/** The version row's reason for this revision: the old words stay readable under it. */
export const TOLD_REVISE_REASON = "told-v2";

export interface ToldRevision {
  /** Rows rewritten to v2's words. */
  readonly revised: string[];
  /** Rows of a changed memory left as they were: corrected, let go, or not v1's words. */
  readonly kept: number;
  /** Rows whose rewrite threw (on a hold, say): the store stays `v1`, and the next open tries again. */
  readonly failed: number;
}

/**
 * The version row's reason when a starter memory changes SURFACE (EX1): a
 * hosted export opened by a local install, or a local store opened by hosted.
 */
export const TOLD_SURFACE_REASON = "told-surface";

/**
 * BRING A STORE'S UNCHANGED STARTERS TO THE WORDS THEY SHOULD SAY NOW, once.
 *
 * Two cases, one pass, one safeguard. (a) A v1 store (HD1): the memories v2
 * changed get v2's words for the store's own surface. (b) A store opened on
 * the OTHER surface (EX1, 2026-11-04): `opening` names the surface of the door
 * that opened it, and when it differs from the store's `told.surface` — a
 * hosted "Download my memory" file opened by a local install, say — every
 * starter still in the recorded surface's words gets the opening surface's
 * (its title too: #7's differs by surface). `opening` absent (the worker, which
 * serves both) never switches.
 *
 * Nothing to do — no set (every store from before S1), a set past v1 on the
 * surface it was planted for — answers `null` after a meta read or two and
 * writes nothing. Otherwise each memory of the set is looked for by its
 * recorded-surface title among the told rows; one that is live (not archived,
 * not superseded) and still exactly the words it was planted with (v2's for
 * the recorded surface, or v1's while the store says v1) is rewritten through
 * `Store#revise`, the door that keeps its id and its source, files the old
 * words as a version, and re-indexes the row; its meta says `told: "v2"`. A row
 * the person corrected, let go, or a night rewrote is theirs and stays. Then
 * the store's meta says v2 and the surface the words are now in, whether or
 * not anything matched — unless a rewrite threw, when it stays as it was so
 * the next open tries again (a match is exact, so a second pass never
 * rewrites twice).
 */
export function reviseTold(store: Store, opening?: ToldSurface): ToldRevision | null {
  const set = store.getMeta(TOLD_SET_KEY);
  const surface = store.getMeta(TOLD_SURFACE_KEY);
  if (surface !== "local" && surface !== "hosted") return null;
  const switching = opening !== undefined && opening !== surface;
  if (set !== TOLD_SET_V1 && !(set === TOLD_SET_VERSION && switching)) return null;
  const target: ToldSurface = switching ? opening : surface;
  const from = toldSet(surface);
  const to = toldSet(target);
  const v1 = set === TOLD_SET_V1 ? new Map(toldV1Words(surface).map((c) => [c.title, c.bodies])) : new Map<string, readonly string[]>();
  const reason = switching ? TOLD_SURFACE_REASON : TOLD_REVISE_REASON;
  const rows = store.toldIds().map((id) => store.row(id));
  const revised: string[] = [];
  let kept = 0;
  let failed = 0;
  for (let i = 0; i < from.length; i += 1) {
    const was = from[i]!;
    const now = to[i]!;
    // The words that count as "as planted": v2's for the recorded surface,
    // and v1's while the store still says v1.
    const bodies = [was.body, ...(v1.get(was.title) ?? [])];
    // ONE TEST, asked of the first read and again under the write lock: the
    // row already says the target words (nothing to do), or it is still as
    // planted (rewrite it). Without the first half under the lock, a second
    // opener's stale read rewrote v2 over v2 when the surface didn't change
    // (review of 41e490ed).
    const done = (r: { title: string | null; body: string }): boolean => r.title === now.title && r.body === now.body;
    const asPlanted = (r: { title: string | null; body: string; archived: number; superseded_by: string | null }): boolean =>
      !done(r) && r.archived === 0 && r.superseded_by === null && r.title === was.title && bodies.includes(r.body);
    for (const row of rows) {
      if (row === undefined || row.title !== was.title) continue;
      // Already the words it should say: nothing to do, nothing to count.
      if (done(row)) continue;
      if (row.source !== TOLD_SOURCE || !asPlanted(row)) {
        kept += 1;
        continue;
      }
      try {
        // RE-ASKED UNDER THE WRITE LOCK (review of 474db3cf, R4-a): the hook,
        // the MCP server and the worker can open at once on the first launch
        // after an upgrade; the one that comes second finds the new words and
        // writes nothing (no duplicate version).
        const seq = store.revise(row.id, {
          body: now.body,
          ...(now.title === was.title ? {} : { title: now.title }),
          meta: { told: TOLD_SET_VERSION },
          reason,
          unless: (cur) => !asPlanted(cur),
        });
        if (seq > 0) revised.push(row.id);
        else kept += 1;
      } catch {
        failed += 1;
      }
    }
  }
  if (failed === 0) {
    store.setMetaMany([
      [TOLD_SET_KEY, TOLD_SET_VERSION],
      [TOLD_SURFACE_KEY, target],
    ]);
  }
  return { revised, kept, failed };
}
