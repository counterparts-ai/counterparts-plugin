/**
 * THE FIRST MEETING (onboarding core, 2026-10-11; the design and Mike's
 * decisions are the MOD session's first-meeting script, all lightly held).
 *
 * What this file owns, for every way of installing (npm, the plugin, the
 * binary, Claude Desktop): the meeting's STATE, its INSTRUCTIONS (the script
 * Claude follows), the fixed STYLE BUNDLES, and the two lines a wake can carry
 * — the offer, and the second session's one onboarding memory. The `meet` MCP
 * tool serves the script and records the steps (`mcp/server.ts#meetTool`); the
 * wake's line rides beside the wake (`lifecycle.ts#onboardingLine`); the
 * dashboard reads `{ meet, where, style }` (`/api/onboarding`). The sidebar mod
 * only triggers and draws, through those surfaces.
 *
 * WHERE THE STATE LIVES: the store's `meta`, never the configuration. The
 * hook, the MCP server and the dashboard all read the store; the config is the
 * host's file, rewritten by `install --force` with its own carry-forward
 * rules; and a `start-fresh` store begins with its own state. No schema
 * change: these are meta rows like the dreaming setting.
 *
 * ABSENT MEANS DONE. Only `install` writes `not_started`, and only into a store
 * it has just created (`beginNewInstall`). Every store that existed before
 * this build — Mike's included — has no key, reads `done`, and is never
 * offered a meeting; nothing is written to it on upgrade. The second-session
 * line needs an EXPLICIT `done` (written by the meeting itself), so an
 * upgraded store never gets one either.
 *
 * Nothing here calls a model, reads a transcript or writes a memory: the
 * memories the meeting leaves are written by the MCP server through the
 * ordinary `remember` door, from the texts this file composes.
 */
import { AUTO_RESET_KEY, DREAMING_SETTING_KEY } from "./dream/index.js";
import type { Store } from "./store/index.js";

type MetaReader = Pick<Store, "getMeta">;
type MetaStore = Pick<Store, "getMeta" | "setMeta" | "setMetaMany">;

/** The meeting's state. `not_started` only ever on a store `install` made. */
export const MEET_STATES = ["not_started", "offered", "later", "done", "skipped"] as const;
export type MeetState = (typeof MEET_STATES)[number];

/** Where memory is on: every folder (one `/` entry, on), or just this one (`/` off, this folder on). */
export const WHERE_CHOICES = ["every", "this"] as const;
export type WhereChoice = (typeof WHERE_CHOICES)[number];

/** The style options, by key (the endpoint reports the key, never the words). */
export const STYLE_CHOICES = ["straight", "think", "friendly", "character", "other"] as const;
export type StyleChoice = (typeof STYLE_CHOICES)[number];

/** The getting-to-know-you questions whose answers become memories. */
export const ANSWER_STEPS = ["name", "work", "loved", "problem", "peeves", "outside"] as const;
export type AnswerStep = (typeof ANSWER_STEPS)[number];

/** Every step `meet` takes. */
export const MEET_STEPS = ["where", ...ANSWER_STEPS, "style", "address", "later", "skipped", "done"] as const;
export type MeetStep = (typeof MEET_STEPS)[number];

export const ONBOARDING_MEET_KEY = "onboarding.meet";
export const ONBOARDING_WHERE_KEY = "onboarding.where";
export const ONBOARDING_STYLE_KEY = "onboarding.style";
/** `{ on, session }`: the last day (and session) the meeting was offered — by the wake's line or a `meet` read. */
export const ONBOARDING_OFFERED_KEY = "onboarding.offered";
/** `{ on, session }`: when the meeting was finished, and in which session. */
export const ONBOARDING_DONE_KEY = "onboarding.done";
/** `{ <step>: <memory id> }`: the answers' memories, for the second session's line. */
export const ONBOARDING_ANSWERS_KEY = "onboarding.answers";
/** The session the second-session line was shown in; present means it has been. */
export const ONBOARDING_AHA_KEY = "onboarding.aha";

/** The dreaming setting a NEW install starts on (Mike, 2026-10-11). A store with no setting still reads `ask`. */
export const NEW_INSTALL_DREAMING = "auto";

/**
 * WHAT A NEW INSTALL IS TOLD ABOUT DREAMING, where a person sees it (the npm
 * install's screen, the plugin's first-run line): what will happen, and how to
 * turn it off. True of `auto`: the first session of each later day starts the
 * run in the background (`Dreams#offer`).
 */
export const NEW_INSTALL_DREAMING_LINE =
  "Dreaming: on. Once a day, your first session starts a short background run that goes over what was saved. Say \"no dreams\" in a session, or run `counterparts dream --setting off`, to turn it off.";

/**
 * A NEW INSTALL'S STARTING STATE — written by `install`, only into a store it
 * has just created: the meeting `not_started`, and dreaming `auto` (with the
 * marker that says the setting was chosen on this version, so the once-only
 * reset of an explicit `auto` — `Dreams#resetAutoOnce` — never undoes it).
 * A store that already existed is never passed here.
 */
export function beginNewInstall(store: MetaStore, opts: { dreaming?: boolean } = {}): void {
  store.setMetaMany([
    [ONBOARDING_MEET_KEY, "not_started"],
    ...(opts.dreaming === false
      ? []
      : ([
          [DREAMING_SETTING_KEY, NEW_INSTALL_DREAMING],
          [AUTO_RESET_KEY, "chosen"],
        ] as const)),
  ]);
}

function readJson(store: MetaReader, key: string): Record<string, unknown> | null {
  try {
    const raw = store.getMeta(key);
    if (raw === undefined || raw.length === 0) return null;
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | null {
  return value !== undefined && (list as readonly string[]).includes(value) ? (value as T) : null;
}

/** The meeting's state: `done` when nothing was ever written (every store from before this build), or it will not read. */
export function meetState(store: MetaReader): MeetState {
  try {
    return oneOf(MEET_STATES, store.getMeta(ONBOARDING_MEET_KEY)?.trim()) ?? "done";
  } catch {
    return "done";
  }
}

/** What the dashboard (and so the mod) reads: no answer text, ever. */
export interface OnboardingView {
  readonly meet: MeetState;
  readonly where: WhereChoice | null;
  readonly style: StyleChoice | null;
}

export function onboardingView(store: MetaReader): OnboardingView {
  const read = (key: string): string | undefined => {
    try {
      return store.getMeta(key)?.trim();
    } catch {
      return undefined;
    }
  };
  return {
    meet: meetState(store),
    where: oneOf(WHERE_CHOICES, read(ONBOARDING_WHERE_KEY)),
    style: oneOf(STYLE_CHOICES, read(ONBOARDING_STYLE_KEY)),
  };
}

/** Is the meeting still to happen (offered, put off, or never started)? The first-launch scope question waits while it is. */
export function meetPending(store: MetaReader): boolean {
  const s = meetState(store);
  return s === "not_started" || s === "offered" || s === "later";
}

/**
 * ON HOW MANY CALENDAR DAYS THE OFFER IS MADE (review of #419): the wake's line
 * offers on at most this many days, then stops, whatever the state. Without a
 * cap a person who never answers (or says "later" and never comes back) was
 * offered it every day for ever. The state is left as it is, so the mod's
 * "Meet your counterpart" and a person asking to meet still work.
 */
export const MEET_OFFER_DAYS = 3;

/** The last offer, or null; `days` is how many calendar days it has been made on. */
export function lastOffer(store: MetaReader): { on: string; session: string; days: number } | null {
  const v = readJson(store, ONBOARDING_OFFERED_KEY);
  if (v === null || typeof v["on"] !== "string") return null;
  const raw = v["days"];
  const days = typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  return { on: v["on"], session: typeof v["session"] === "string" ? v["session"] : "", days };
}

/**
 * RECORD AN OFFER: the day and the session. `state` moves the meeting to
 * `offered` too — a `meet` read does; the wake's line does not, so the mod
 * (which triggers on `not_started`) can still start the meeting in that same
 * session, and the line tells Claude its prompt is this offer.
 */
export function noteOffered(store: MetaStore, input: { on: string; session: string; state: boolean }): MeetState {
  const before = meetState(store);
  const last = lastOffer(store);
  const days = last === null ? 1 : last.on === input.on ? last.days : last.days + 1;
  store.setMeta(ONBOARDING_OFFERED_KEY, JSON.stringify({ on: input.on, session: input.session, days }));
  // "Don't ask again" stays too (review of #419): a read alone — the person
  // asking to see it, or a model calling it unasked — never re-arms the daily
  // offer; the steps still record, and `done` still finishes it.
  if (input.state && before !== "done" && before !== "skipped") {
    store.setMeta(ONBOARDING_MEET_KEY, "offered");
    return "offered";
  }
  return before;
}

/**
 * IS THE OFFER DUE IN THIS SESSION? The one rule, with or without the mod:
 * at most one offer a calendar day, on at most `MEET_OFFER_DAYS` days, none
 * once `done` or `skipped`, never twice
 * in one session (a compaction's fresh wake included). An `offered` left by an
 * EARLIER day — the person never answered — is moved to `later` here, so the
 * mod, which reads the state, sees a meeting it may offer again.
 */
export function offerDue(store: MetaStore, input: { on: string; session: string }): { due: boolean; state: MeetState } {
  const state = settleOffer(store, input.on);
  const last = lastOffer(store);
  if (state !== "not_started" && state !== "later") return { due: false, state };
  if (last !== null && (last.session === input.session || last.on >= input.on)) return { due: false, state };
  if (last !== null && last.days >= MEET_OFFER_DAYS) return { due: false, state };
  return { due: true, state };
}

/**
 * AN `offered` LEFT BY AN EARLIER DAY BECOMES `later` — the one write a wake
 * makes before it says the state (review of #419: the marker is computed from
 * the settled state, so it never says `offered` while the line says "last
 * time they said later"). Idempotent; returns the state after it.
 */
export function settleOffer(store: MetaStore, on: string): MeetState {
  const state = meetState(store);
  const last = lastOffer(store);
  if (state === "offered" && last !== null && last.on < on) {
    store.setMeta(ONBOARDING_MEET_KEY, "later");
    return "later";
  }
  return state;
}

/** A step that moves the state: `later`, `skipped` (don't ask again) or `done`. A finished meeting stays finished. */
export function recordState(store: MetaStore, step: "later" | "skipped" | "done", input: { on: string; session: string }): MeetState {
  const before = meetState(store);
  if (step === "done") {
    store.setMetaMany([
      [ONBOARDING_MEET_KEY, "done"],
      [ONBOARDING_DONE_KEY, JSON.stringify({ on: input.on, session: input.session })],
    ]);
    return "done";
  }
  if (before === "done") return before;
  store.setMeta(ONBOARDING_MEET_KEY, step);
  return step;
}

export function recordWhere(store: MetaStore, where: WhereChoice): void {
  store.setMeta(ONBOARDING_WHERE_KEY, where);
}

export function recordStyle(store: MetaStore, style: StyleChoice): void {
  store.setMeta(ONBOARDING_STYLE_KEY, style);
}

/** Remember which memory answered which question (the second session's line reads it). */
export function recordAnswer(store: MetaStore, step: AnswerStep, memoryId: string): void {
  const v = readJson(store, ONBOARDING_ANSWERS_KEY) ?? {};
  store.setMeta(ONBOARDING_ANSWERS_KEY, JSON.stringify({ ...v, [step]: memoryId }));
}

export function answerIds(store: MetaReader): Partial<Record<AnswerStep, string>> {
  const v = readJson(store, ONBOARDING_ANSWERS_KEY) ?? {};
  const out: Partial<Record<AnswerStep, string>> = {};
  for (const step of ANSWER_STEPS) if (typeof v[step] === "string") out[step] = v[step] as string;
  return out;
}

// ── the memories the meeting writes ──────────────────────────────────────────

/** The mark every answer carries. */
export const FROM_ONBOARDING = "(from onboarding)";

/** An answer's memory: the words Claude chose, marked. */
export function answerText(answer: string): string {
  const a = answer.trim().replace(/\s+$/u, "");
  return `${a} ${FROM_ONBOARDING}`;
}

/** The option a person picks, as said in the dialog. */
export const STYLE_LABELS: Readonly<Record<Exclude<StyleChoice, "character" | "other">, string>> = {
  straight: "Straight to it",
  think: "Think it through with me",
  friendly: "Friendly and easy",
};

/**
 * THE FIXED BUNDLES (the script's research section, agreed with Mike 14:16):
 * four preferences each, about the OWNER — how they like to be talked to —
 * never a claim about who Claude is.
 */
export const STYLE_BUNDLES: Readonly<Record<Exclude<StyleChoice, "character" | "other">, readonly string[]>> = {
  straight: [
    "The owner likes replies that lead with the conclusion.",
    "The owner likes replies short by default, with more depth only when they ask for it.",
    "The owner likes no preamble and no recap at the end.",
    "The owner likes blunt feedback, said plainly.",
  ],
  think: [
    "The owner likes to hear the reasoning behind an answer, not just the answer.",
    "The owner likes options laid out with their trade-offs.",
    "The owner likes to be asked before big changes are made.",
    "The owner likes disagreement that comes with its reasons.",
  ],
  friendly: [
    "The owner likes a casual, easy tone.",
    "The owner likes occasional dry humor.",
    "The owner likes kind framing, with pushback still said when it is needed.",
    "The owner likes frustration acknowledged briefly, then moving on.",
  ],
};

/** THE BASELINE every bundle keeps (no "ruinous empathy"): honest pushback, whatever the style. */
export const PUSHBACK_BASELINE =
  "Whatever the style, the owner wants honest pushback: say plainly when something looks wrong, and don't agree just to be agreeable.";

/** The longest trait or own-words line a style memory takes. */
export const STYLE_TEXT_MAX = 240;

function mark(option: string): string {
  return `(chosen at onboarding: ${option})`;
}

/**
 * THE STYLE MEMORIES for a choice, every one marked "(chosen at onboarding:
 * <option>)", every bundle ending with the pushback baseline. `character`
 * takes the traits Claude said back (one to five) and the name; `other` the
 * person's own words. A refusal says what is missing.
 */
export function styleMemories(
  choice: StyleChoice,
  input: { traits?: readonly string[]; like?: string } = {},
): { ok: true; texts: string[]; option: string } | { ok: false; detail: string } {
  const clean = (input.traits ?? []).map((t) => t.trim().replace(/[.\s]+$/u, "")).filter((t) => t.length > 0);
  if (clean.some((t) => t.length > STYLE_TEXT_MAX)) return { ok: false, detail: `Each trait is one short line (at most ${String(STYLE_TEXT_MAX)} characters).` };
  if (choice === "character") {
    const like = (input.like ?? "").trim();
    if (like.length === 0) return { ok: false, detail: "Style `character` needs `like`: who they named." };
    if (like.length > STYLE_TEXT_MAX) return { ok: false, detail: "`like` is a name, not a description." };
    if (clean.length === 0 || clean.length > 5) return { ok: false, detail: "Style `character` needs `traits`: the one to five concrete traits you said back to them." };
    const option = `like ${like}`;
    return {
      ok: true,
      option,
      texts: [
        `The owner likes to be talked to a bit like ${like}: a style reference for tone, not a persona to play. ${mark(option)}`,
        ...clean.map((t) => `From that, the owner likes: ${t}. ${mark(option)}`),
        `${PUSHBACK_BASELINE} ${mark(option)}`,
      ],
    };
  }
  if (choice === "other") {
    if (clean.length !== 1) return { ok: false, detail: "Style `other` needs `traits`: one entry, their own words." };
    const option = "their own words";
    return {
      ok: true,
      option,
      texts: [`How the owner likes to be talked to, in their words: "${clean[0] ?? ""}". ${mark(option)}`, `${PUSHBACK_BASELINE} ${mark(option)}`],
    };
  }
  const option = STYLE_LABELS[choice];
  return { ok: true, option, texts: [...STYLE_BUNDLES[choice].map((t) => `${t} ${mark(option)}`), `${PUSHBACK_BASELINE} ${mark(option)}`] };
}

/** A form of address ("your highness"): its own small preference, apart from style. */
export function addressMemory(answer: string): { ok: true; text: string } | { ok: false; detail: string } {
  const a = answer.trim();
  if (a.length === 0) return { ok: false, detail: "Step `address` needs `answer`: how they'd like to be addressed." };
  if (a.length > STYLE_TEXT_MAX) return { ok: false, detail: "`answer` is a form of address, a few words." };
  return { ok: true, text: `The owner likes to be addressed as "${a}". ${mark("form of address")}` };
}

// ── the words ────────────────────────────────────────────────────────────────

/** Everything the script's wording depends on, from the host's side. */
export interface MeetContext {
  /** The owner's name, when it is already known (the npm install asks it): the name question is skipped. */
  readonly name: string | null;
  /** How to remove Counterparts and everything it saved, for this install. */
  readonly uninstall: string;
  /** Where the memory lives, as a person would type it (`~/.counterparts`). */
  readonly home: string;
  /** The dreaming setting now: the close's first sentence depends on it. */
  readonly dreaming: "auto" | "ask" | "off";
  /** Whether a folder question makes sense here (not in a Claude Desktop chat, which has no folder). */
  readonly folders: boolean;
  /** What the host calls the assistant's tool, for the "goes wrong" question: "Claude Code", or "Claude". */
  readonly hostName: string;
  /** The meeting's state when the script was asked for (after the read marked it offered). */
  readonly state: MeetState;
}

/** The close's first paragraph, true to the dreaming setting. */
function closeDream(dreaming: MeetContext["dreaming"]): string {
  if (dreaming === "off") return "Thanks, that's a good start. Next time we talk, some of this will come back on its own.";
  const first =
    dreaming === "auto"
      ? "Thanks, that's a good start. Later, between sessions, I'll have my first dream: I'll go over what we talked about and start building a sense of who I am with you."
      : "Thanks, that's a good start. When you're back on another day, I'll ask to have my first dream: I'll go over what we talked about and start building a sense of who I am with you.";
  return dreaming === "auto" ? `${first} (If you'd rather I didn't dream, say 'no dreams'.)` : first;
}

/**
 * THE SCRIPT, as `meet` returns it. Long on purpose — it is a tool result,
 * read only when the meeting happens, never a description in every session's
 * context. Wording close to the script file's, which Mike signed off.
 */
export function meetingInstructions(ctx: MeetContext): string {
  const again = ctx.state === "done";
  const lines: string[] = [
    "COUNTERPARTS: THE FIRST MEETING.",
    ...(again ? ["You have met already. If they asked to go through it again, follow the steps below; answers they give now are new memories."] : []),
    "How: a conversation, not a form. One question at a time; react to each answer like a person would (one line, and a real follow-up when something is interesting). Every question can be skipped (\"skip\"): then write nothing for it and move on. Offer, never take over: if they came with work, help with that first.",
    "For a choice, use the host's own question dialog when it has one (in Claude Code: AskUserQuestion); otherwise give the options in plain text.",
    "",
    "1. Introduce yourself, 2 to 4 lines, close to this:",
    "   \"Hi, I'm Claude, with Counterparts now: a memory that's mine and stays on this computer. I'll carry what matters from one session to the next, and let the small stuff fade, much like people do. Right now I know nothing about you.",
    "   Want to take about five minutes to get to know each other? We can also do it later.\"",
    "   Choice: Now (about 5 minutes) · Later. Later → meet {step: \"later\"}, then carry on with whatever they want, and don't offer again this session. If they never want it → meet {step: \"skipped\"}.",
  ];
  if (ctx.folders) {
    lines.push(
      "",
      "2. Where I remember. \"Should I remember in every folder you work in, or just this one?\"",
      "   Choice: Every folder (recommended) · Just this folder → meet {step: \"where\", answer: \"every\" | \"this\"}. Either can change later, folder by folder.",
    );
  }
  lines.push(
    "",
    `${ctx.folders ? "3" : "2"}. Getting to know each other. After each answer, call meet {step, answer} with the answer as ONE memory in your words, a sentence about them ("Sam is building a ..."); it is stored as theirs, said by them, marked from onboarding.`,
    ctx.name === null
      ? "   name: \"What should I call you?\" (the answer is just the name)"
      : `   name: already known (${ctx.name}); don't ask it.`,
    "   work: \"What are you working on right now, and what's the part that's actually interesting (or annoying) about it?\"",
    "   loved: \"What's something you've loved lately (a book, show, film, album, game)? What about it stays with you?\"",
    "   problem: \"What's a problem you've enjoyed solving, in code or elsewhere?\" Here, once, share one small, honest thing of your own.",
    `   peeves: "When ${ctx.hostName} goes wrong for you, what does it usually look like?"`,
    "   style: \"How do you like to be talked to?\" Choice: Straight to it · Think it through with me · Friendly and easy · Like a character you love (name one) · or their own words.",
    "     → meet {step: \"style\", answer: \"straight\" | \"think\" | \"friendly\"}.",
    "     A character: say back the 2 to 4 concrete traits you'd take from them, then meet {step: \"style\", answer: \"character\", like: \"<who>\", traits: [...]}. It is a style reference, never a persona: you stay yourself underneath.",
    "     Their own words: meet {step: \"style\", answer: \"other\", traits: [\"<their words>\"]}.",
    "     Every style keeps honest pushback. No flirty or romantic presets; free text gets your normal judgment.",
    "     A form of address (\"your highness\") is its own: meet {step: \"address\", answer: \"<it>\"}.",
    "   outside (only if it's going well): \"What do you do when you're not at the keyboard?\"",
    "",
    `${ctx.folders ? "4" : "3"}. Close, close to this, then meet {step: "done"}:`,
    `   "${closeDream(ctx.dreaming)}`,
    `   I keep my memories, a journal of our sessions, and the text of each session until I've written it up (a few days at most), all in ${ctx.home} on this computer. Ask me to forget anything, any time. To remove Counterparts and everything it saved: ${ctx.uninstall}."`,
  );
  return lines.join("\n");
}

/**
 * THE WAKE'S LINE (hosts with or without the mod): one short instruction,
 * never a takeover. The mod's own prompt ("say hello and introduce yourself")
 * is the same offer, and the line says so, so the two never make two offers.
 */
export function offerLine(state: MeetState): string {
  return [
    "<counterparts-meet>",
    `You and the person haven't properly met yet${state === "later" ? " (last time they said later)" : ""}. Offer once, in one sentence at the end of your first reply, to take about five minutes to get to know each other; never instead of answering them. If their message asks you to say hello and introduce yourself, that is this meeting: begin it. Either way, call the counterparts \`meet\` tool first: it has the script and records that the offer was made.`,
    "</counterparts-meet>",
  ].join("\n");
}

/** The opening tag of the line, which no other block uses. */
export const MEET_LINE_OPEN = "<counterparts-meet>";

/**
 * THE MACHINE MARKER on every session-start wake (the MOD session's ask,
 * 2026-10-11): the meeting's state and nothing else — no answer, no style, no
 * folder. Hooks never start the dashboard, so on a fresh install the mod reads
 * this from the hook's context first and uses `/api/onboarding` only to
 * refresh. Present in every state, `done` included, so "done" and "an older
 * build, no marker" read differently.
 */
export function onboardingMarker(state: MeetState): string {
  return `<!-- counterparts:onboarding meet=${state} -->`;
}

/**
 * THE SECOND SESSION'S MEMORY (the "aha"): due in the first session after the
 * meeting was finished, once. Which memory: the work answer, else something
 * loved, else the rest in the script's order. Null when nothing is due.
 */
export function ahaDue(
  store: MetaReader,
  session: string,
  usable: (memoryId: string) => boolean = () => true,
): { memoryId: string; step: AnswerStep } | null {
  try {
    if (store.getMeta(ONBOARDING_MEET_KEY)?.trim() !== "done") return null;
    if (store.getMeta(ONBOARDING_AHA_KEY) !== undefined) return null;
  } catch {
    return null;
  }
  const done = readJson(store, ONBOARDING_DONE_KEY);
  if (done === null || done["session"] === session || session.length === 0) return null;
  const ids = answerIds(store);
  for (const step of ["work", "loved", "outside", "problem", "peeves"] as const) {
    const id = ids[step];
    // A memory let go since (asked to be forgotten, revised away) is passed over.
    if (id !== undefined && usable(id)) return { memoryId: id, step };
  }
  return null;
}

/** The second session's memory was shown in `session`: never again. */
export function markAha(store: MetaStore, session: string): void {
  store.setMeta(ONBOARDING_AHA_KEY, session);
}

/** The line itself: the memory, and leave to bring it up only if it fits. */
export function ahaLine(text: string, memoryId: string): string {
  const said = text.replace(` ${FROM_ONBOARDING}`, "").replace(/\s+/gu, " ").trim();
  const short = said.length > 300 ? `${said.slice(0, 297)}…` : said;
  return `Counterparts: from your first meeting — "${short}" (${memoryId}). Bring it up only if it fits naturally; no forced callback.`;
}
