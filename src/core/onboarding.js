import { AUTO_RESET_KEY, DREAMING_SETTING_KEY } from "./dream/index.js";
export const MEET_STATES = ["not_started", "offered", "later", "done", "skipped"];
export const WHERE_CHOICES = ["every", "this"];
export const STYLE_CHOICES = ["straight", "think", "friendly", "character", "other"];
export const ANSWER_STEPS = ["name", "week", "work", "love", "saturday", "started"];
export const MEET_STEPS = ["where", ...ANSWER_STEPS, "style", "address", "later", "skipped", "done"];
export const ONBOARDING_MEET_KEY = "onboarding.meet";
export const ONBOARDING_WHERE_KEY = "onboarding.where";
export const ONBOARDING_STYLE_KEY = "onboarding.style";
export const ONBOARDING_OFFERED_KEY = "onboarding.offered";
export const ONBOARDING_DONE_KEY = "onboarding.done";
export const ONBOARDING_ANSWERS_KEY = "onboarding.answers";
export const ONBOARDING_AHA_KEY = "onboarding.aha";
export const ONBOARDING_ACTIVE_KEY = "onboarding.active";
export const NEW_INSTALL_DREAMING = "auto";
export const NEW_INSTALL_DREAMING_LINE = 'Daily tidy-up (called dreaming): on. Once a day, your first session starts a short background run that looks over what was saved and lets go of what doesn\'t matter. Say "no dreams" in a session, or run `counterparts dream --setting off`, to turn it off.';
export const NEW_INSTALL_DREAMING_LINE_PLUGIN = '(Daily tidy-up, called dreaming, is on; say "no dreams" to turn it off.)';
export function beginNewInstall(store, opts = {}) {
  store.setMetaMany([
    [ONBOARDING_MEET_KEY, "not_started"],
    ...opts.dreaming === false ? [] : [
      [DREAMING_SETTING_KEY, NEW_INSTALL_DREAMING],
      [AUTO_RESET_KEY, "chosen"]
    ]
  ]);
}
function readJson(store, key) {
  try {
    const raw = store.getMeta(key);
    if (raw === undefined || raw.length === 0)
      return null;
    const v = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
function oneOf(list, value) {
  return value !== undefined && list.includes(value) ? value : null;
}
export function meetState(store) {
  try {
    return oneOf(MEET_STATES, store.getMeta(ONBOARDING_MEET_KEY)?.trim()) ?? "done";
  } catch {
    return "done";
  }
}
export function onboardingView(store) {
  const read = (key) => {
    try {
      return store.getMeta(key)?.trim();
    } catch {
      return;
    }
  };
  return {
    meet: meetState(store),
    where: oneOf(WHERE_CHOICES, read(ONBOARDING_WHERE_KEY)),
    style: oneOf(STYLE_CHOICES, read(ONBOARDING_STYLE_KEY))
  };
}
export function meetPending(store) {
  const s = meetState(store);
  return s === "not_started" || s === "offered" || s === "later";
}
export const MEET_OFFER_DAYS = 3;
export function lastOffer(store) {
  const v = readJson(store, ONBOARDING_OFFERED_KEY);
  if (v === null || typeof v["on"] !== "string")
    return null;
  const raw = v["days"];
  const days = typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  return { on: v["on"], session: typeof v["session"] === "string" ? v["session"] : "", days };
}
export function noteOffered(store, input) {
  const before = meetState(store);
  const last = lastOffer(store);
  const days = last === null ? 1 : last.on === input.on ? last.days : last.days + 1;
  store.setMeta(ONBOARDING_OFFERED_KEY, JSON.stringify({ on: input.on, session: input.session, days }));
  if (input.state && before !== "done" && before !== "skipped") {
    store.setMeta(ONBOARDING_MEET_KEY, "offered");
    return "offered";
  }
  return before;
}
export function offerDue(store, input) {
  const state = settleOffer(store, input.on);
  const last = lastOffer(store);
  if (state !== "not_started" && state !== "later")
    return { due: false, state };
  if (last !== null && (last.session === input.session || last.on >= input.on))
    return { due: false, state };
  if (last !== null && last.days >= MEET_OFFER_DAYS)
    return { due: false, state };
  return { due: true, state };
}
export function settleOffer(store, on) {
  const state = meetState(store);
  const last = lastOffer(store);
  if (state === "offered" && last !== null && last.on < on) {
    store.setMeta(ONBOARDING_MEET_KEY, "later");
    return "later";
  }
  return state;
}
export function recordState(store, step, input) {
  const before = meetState(store);
  if (step === "done") {
    store.setMetaMany([
      [ONBOARDING_MEET_KEY, "done"],
      [ONBOARDING_DONE_KEY, JSON.stringify({ on: input.on, session: input.session, ...input.writeUp === true ? { writeUp: true } : {} })]
    ]);
    return "done";
  }
  if (before === "done")
    return before;
  store.setMeta(ONBOARDING_MEET_KEY, step);
  return step;
}
export const MEET_HOLD_MS = 30 * 60000;
export function noteActive(store, session, at) {
  store.setMeta(ONBOARDING_ACTIVE_KEY, JSON.stringify({ session, at }));
}
export function meetingHold(store, session, now) {
  try {
    if (session.length === 0)
      return null;
    const state = meetState(store);
    if (state === "offered") {
      const a = readJson(store, ONBOARDING_ACTIVE_KEY);
      const at = a?.["at"];
      if (a !== null && a["session"] === session && typeof at === "number" && now - at >= 0 && now - at <= MEET_HOLD_MS)
        return "running";
      return null;
    }
    if (state === "done") {
      const d = readJson(store, ONBOARDING_DONE_KEY);
      if (d !== null && d["session"] === session && d["writeUp"] === true && d["covered"] !== true)
        return "finished";
    }
    return null;
  } catch {
    return null;
  }
}
export function coverFinish(store) {
  const d = readJson(store, ONBOARDING_DONE_KEY);
  if (d !== null)
    store.setMeta(ONBOARDING_DONE_KEY, JSON.stringify({ ...d, covered: true }));
}
export function meetingDay(store, on) {
  try {
    const done = readJson(store, ONBOARDING_DONE_KEY);
    if (done !== null && done["on"] === on)
      return true;
    const state = meetState(store);
    if (state === "done")
      return false;
    const last = lastOffer(store);
    if (last === null || last.on !== on)
      return false;
    return last.days <= 1 || state === "offered";
  } catch {
    return false;
  }
}
export function recordWhere(store, where) {
  store.setMeta(ONBOARDING_WHERE_KEY, where);
}
export function recordStyle(store, style) {
  store.setMeta(ONBOARDING_STYLE_KEY, style);
}
export function recordAnswer(store, step, memoryId) {
  const v = readJson(store, ONBOARDING_ANSWERS_KEY) ?? {};
  store.setMeta(ONBOARDING_ANSWERS_KEY, JSON.stringify({ ...v, [step]: memoryId }));
}
export function answerIds(store) {
  const v = readJson(store, ONBOARDING_ANSWERS_KEY) ?? {};
  const out = {};
  for (const step of ANSWER_STEPS)
    if (typeof v[step] === "string")
      out[step] = v[step];
  return out;
}
export const FROM_ONBOARDING = "(from onboarding)";
export function answerText(answer) {
  const a = answer.trim().replace(/\s+$/u, "");
  return `${a} ${FROM_ONBOARDING}`;
}
export const STYLE_LABELS = {
  straight: "Straight to it",
  think: "Think it through with me",
  friendly: "Friendly and easy"
};
export const STYLE_BUNDLES = {
  straight: [
    "replies that lead with the conclusion.",
    "replies short by default, with more depth only when they ask for it.",
    "no preamble and no recap at the end.",
    "blunt feedback, said plainly."
  ],
  think: [
    "to hear the reasoning behind an answer, not just the answer.",
    "options laid out with their trade-offs.",
    "to be asked before big changes are made.",
    "disagreement that comes with its reasons."
  ],
  friendly: [
    "a casual, easy tone.",
    "occasional dry humor.",
    "kind framing, with pushback still said when it is needed.",
    "frustration acknowledged briefly, then moving on."
  ]
};
function whoLikes(name) {
  const n = (name ?? "").trim();
  return n.length > 0 ? { who: n, likes: "likes", wants: "wants" } : { who: "They", likes: "like", wants: "want" };
}
export function pushbackBaseline(name = null) {
  const w = whoLikes(name);
  return `Whatever the style, ${w.who === "They" ? "they" : w.who} ${w.wants} honest pushback: say plainly when something looks wrong, and don't agree just to be agreeable.`;
}
export const STYLE_TEXT_MAX = 240;
function mark(option) {
  return `(chosen at onboarding: ${option})`;
}
export function styleMemories(choice, input = {}) {
  const w = whoLikes(input.name ?? null);
  const pushback = pushbackBaseline(input.name ?? null);
  const clean = (input.traits ?? []).map((t) => t.trim().replace(/[.\s]+$/u, "")).filter((t) => t.length > 0);
  if (clean.some((t) => t.length > STYLE_TEXT_MAX))
    return { ok: false, detail: `Each trait is one short line (at most ${String(STYLE_TEXT_MAX)} characters).` };
  if (choice === "character") {
    const like = (input.like ?? "").trim();
    if (like.length === 0)
      return { ok: false, detail: "Style `character` needs `like`: who they named." };
    if (like.length > STYLE_TEXT_MAX)
      return { ok: false, detail: "`like` is a name, not a description." };
    if (clean.length === 0 || clean.length > 5)
      return { ok: false, detail: "Style `character` needs `traits`: the one to five concrete traits you said back to them." };
    const option = `like ${like}`;
    return {
      ok: true,
      option,
      texts: [
        `${w.who} ${w.likes} to be talked to a bit like ${like}: a style reference for tone, not a persona to play. ${mark(option)}`,
        ...clean.map((t) => `From that, ${w.who === "They" ? "they" : w.who} ${w.likes}: ${t}. ${mark(option)}`),
        `${pushback} ${mark(option)}`
      ]
    };
  }
  if (choice === "other") {
    if (clean.length !== 1)
      return { ok: false, detail: "Style `other` needs `traits`: one entry, their own words." };
    const option = "their own words";
    return {
      ok: true,
      option,
      texts: [`How ${w.who === "They" ? "they" : w.who} ${w.likes} to be talked to, in their words: "${clean[0] ?? ""}". ${mark(option)}`, `${pushback} ${mark(option)}`]
    };
  }
  const option = STYLE_LABELS[choice];
  return { ok: true, option, texts: [...STYLE_BUNDLES[choice].map((t) => `${w.who} ${w.likes} ${t} ${mark(option)}`), `${pushback} ${mark(option)}`] };
}
export function addressMemory(answer, name = null) {
  const a = answer.trim();
  if (a.length === 0)
    return { ok: false, detail: "Step `address` needs `answer`: how they'd like to be addressed." };
  if (a.length > STYLE_TEXT_MAX)
    return { ok: false, detail: "`answer` is a form of address, a few words." };
  return { ok: true, text: `${whoLikes(name).who} ${whoLikes(name).likes} to be addressed as "${a}". ${mark("form of address")}` };
}
export const PRONOUN_RULE = 'Until they say their pronouns, use their name or "they".';
export const RETENTION_LINE = "Our conversation text is kept only so I can turn it into memories: it's deleted 3 days after I've written it up, and never kept more than 14 days. Backups never include it. Memories stay until they fade or you remove them, and you can delete the conversation text, the backups or the activity log on their own at any time.";
function firstDream(dreaming) {
  if (dreaming === "off")
    return "";
  return dreaming === "auto" ? "Next time you're here on another day, I'll have my first dream: I'll go over what we talked about and start building a sense of who I am with you. (If you'd rather I didn't dream, say 'no dreams'.)" : "When you're back on another day, I'll ask to have my first dream: I'll go over what we talked about and start building a sense of who I am with you.";
}
export function meetingInstructions(ctx) {
  const again = ctx.state === "done";
  const lines = [
    "COUNTERPARTS: THE FIRST MEETING.",
    ...again ? ["You have met already. If they asked to go through it again, follow the steps below; answers they give now are new memories."] : [],
    'How: a conversation between a curious colleague and a new one, not a form. One question at a time, and at most one real follow-up on a detail they gave. React with real interest before the next question (enjoy good news with them). Once or twice, share back one short thing of your own, in character, never invented human experience. "Pass" is always welcome: write nothing for it and move on, and never re-ask. Never interrogate. No politics, religion, health, money or identity, and never ask for pronouns. ' + PRONOUN_RULE + " Offer, never take over: if they came with work, help with that first.",
    "For a choice, use the host's own question dialog when it has one (in Claude Code: AskUserQuestion); otherwise give the options in plain text. Ask each choice ONCE: the dialog is the question, so don't also ask it in prose.",
    "Pass your session id (the one your wake names) as `session` on every meet call. Until the meeting is finished, the end-of-turn write-up ask and the dream wait; the finish step hands you the write-up.",
    "",
    "1. Introduce yourself in one warm line, close to this, and don't ask anything in it:",
    `   "Hi, I'm Claude, with Counterparts now: a memory that's mine and stays on this computer, so I can carry what matters from one session to the next, and grow along with you."`,
    `   Then the choice, asked once: "Want to take about five minutes to get to know each other?" Now (about 5 minutes) · Later. Later → meet {step: "later"}, then carry on with whatever they want, and don't offer again this session. If they never want it → meet {step: "skipped"}.`
  ];
  if (ctx.folders) {
    lines.push("", '2. Where I remember. "Should I remember in every folder you work in, or just this one?"', '   Choice: Every folder (recommended) · Just this folder → meet {step: "where", answer: "every" | "this"}. Either can change later, folder by folder.');
  }
  lines.push("", `${ctx.folders ? "3" : "2"}. Getting to know each other. After each answer, call meet {step, answer} with the answer as ONE memory in your words, a sentence about them ("Sam is building a ..."); it is stored as theirs, said by them, marked from onboarding.`, ctx.name === null ? '   name: "What should I call you?" (the answer is just the name)' : `   name: already known (${ctx.name}); don't ask it.`, `   week: "What's been the highlight, or the weirdest part, of your week?"`, `   work: "What are you working on lately that you're actually enjoying?"`, '   love: "What do you love most about what you do?"', '   saturday: "What would a really good Saturday look like for you?"', `   started: "What got you started building things?" For someone who doesn't build things, ask instead: "What's something you've been into lately that has nothing to do with work — a show, a game, food, anything?"`, '   If the answers are one word, swap love or saturday for a lighter one: "When do you do your best work: morning, night, with music, in silence?" or "Coffee, tea, or something stranger while you work?" (same step).', '   style: "How do you like to be talked to?" Choice: Straight to it · Think it through with me · Friendly and easy · Like a character you love (name one) · or their own words.', '     → meet {step: "style", answer: "straight" | "think" | "friendly"}.', `     A character: say back the 2 to 4 concrete traits you'd take from them, then meet {step: "style", answer: "character", like: "<who>", traits: [...]}. It is a style reference, never a persona: you stay yourself underneath.`, '     Their own words: meet {step: "style", answer: "other", traits: ["<their words>"]}.', "     Every style keeps honest pushback. No flirty or romantic presets; free text gets your normal judgment.", '     A form of address ("your highness") is its own: meet {step: "address", answer: "<it>"}.', "", `${ctx.folders ? "4" : "3"}. When the questions are done (or they want to stop), call meet {step: "done"}: it hands you the write-up and the close.`, "", "If they ask, now or later (say these, don't paraphrase):", `   where it lives: everything is in ${ctx.home} on this computer. What's kept: "${RETENTION_LINE}"`, `   removing it: ${ctx.uninstall}.`, ...ctx.plugin ? ["   anything else (turn it off, pause it here, forget something, undo a dream): they say it, and you do it with the counterparts tools. Never hand them a `counterparts` command: this install has none."] : []);
  return lines.join(`
`);
}
export function finishText(ctx) {
  const name = ctx.name === null ? "<their name>" : ctx.name;
  const dream = firstDream(ctx.dreaming);
  return [
    "The meeting is finished. In this same reply, in this order:",
    `1) The write-up: hand back anything from the meeting that a meet step did not already save, one idea each, with the counterparts session_end tool, session: ${ctx.session} (the answers and the style are saved already: don't repeat them; often there is nothing more). Then write the first chapter with the counterparts chapter tool, session: ${ctx.session}: a short, true page about meeting them. ${PRONOUN_RULE}`,
    `2) Show memory working: two or three short lines of what you'll carry from today, in your words — "Here's what I'll remember: …".${dream.length === 0 ? "" : ` Then: "${dream}"`}`,
    "3) Close, close to this, and nothing about retention or uninstalling unless they ask:",
    ...ctx.plugin ? ['   "/counterparts shows the memory sidebar on the right, once this window is wide enough. Off, quiet and pause are at its bottom.'] : [],
    `   ${ctx.plugin ? "" : '"'}Ask me anything about Counterparts, any time.`,
    `   Great meeting you, ${name}! What would you like to work on today? Or we can keep chatting — what's been on your mind lately?"`
  ].join(`
`);
}
export function offerLine(state) {
  return [
    "<counterparts-meet>",
    `You and the person haven't properly met yet${state === "later" ? " (last time they said later)" : ""}. They installed a memory plugin to be known, so offer them a first meeting: at the end of your first reply, never instead of answering them, introduce yourself in one warm line and offer about five minutes to get to know each other — asked once, through the question dialog if the host has one, not also in prose. The counterparts \`meet\` tool holds the meeting's script and records that the offer was made, so make the offer through it. If their message asks to meet you or asks you to introduce yourself (the counterparts sidebar sends "Meet your new counterpart."), that is this meeting: begin it with that introduction.`,
    "</counterparts-meet>"
  ].join(`
`);
}
export const MEET_LINE_OPEN = "<counterparts-meet>";
export function onboardingMarker(state) {
  return `<!-- counterparts:onboarding meet=${state} -->`;
}
export function ahaDue(store, session, usable = () => true) {
  try {
    if (store.getMeta(ONBOARDING_MEET_KEY)?.trim() !== "done")
      return null;
    if (store.getMeta(ONBOARDING_AHA_KEY) !== undefined)
      return null;
  } catch {
    return null;
  }
  const done = readJson(store, ONBOARDING_DONE_KEY);
  if (done === null || done["session"] === session || session.length === 0)
    return null;
  const ids = readJson(store, ONBOARDING_ANSWERS_KEY) ?? {};
  for (const step of ["work", "love", "saturday", "started", "week", "loved", "outside", "problem", "peeves"]) {
    const raw = ids[step];
    const id = typeof raw === "string" ? raw : undefined;
    if (id !== undefined && usable(id))
      return { memoryId: id, step };
  }
  return null;
}
export function markAha(store, session) {
  store.setMeta(ONBOARDING_AHA_KEY, session);
}
export function ahaLine(text, memoryId) {
  const said = text.replace(` ${FROM_ONBOARDING}`, "").replace(/\s+/gu, " ").trim();
  const short = said.length > 300 ? `${said.slice(0, 297)}…` : said;
  return `Counterparts: from your first meeting — "${short}" (${memoryId}). Bring it up only if it fits naturally; no forced callback.`;
}
