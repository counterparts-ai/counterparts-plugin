import { CORE_EMOTIONS } from "../../core/feelings-wheel.js";
import { LAST_EXCHANGE_HANDLE } from "../../core/handoff/last-exchange.js";
import { RECALL_MAX_IDS } from "./deliberate.js";
import { FACTS_MEANING_CAP, FACTS_PAGE_SIZE } from "./facts.js";
import { RECURRENCES } from "../../core/time.js";
import { PAGE_ROOM_BYTES } from "../../core/self/briefing.js";
import { MEET_STEPS } from "../../core/onboarding.js";
const TITLE_TEXT = "Optional, and asked for: one line saying what this memory is — the line an index shows when it lists memories without their words, so it is worth choosing. Also a handle: recall can expand a memory by its exact title.";
export const TOOL_NAMES = [
  "remember",
  "recall",
  "status",
  "session_end",
  "chapter",
  "scope",
  "self_page",
  "dream",
  "reflect",
  "meet"
];
function annotate(title, hints) {
  return {
    title,
    readOnlyHint: hints.readOnly,
    destructiveHint: hints.destructive ?? false,
    idempotentHint: hints.idempotent ?? hints.readOnly,
    openWorldHint: false
  };
}
const ABOUT_PROPERTY = {
  type: "string",
  enum: ["me", "us", "owner", "work", "world"],
  description: "What this is about, by meaning — me (who I am), us (the owner and me), owner (the owner, as a person), work (the craft: how a job is done), world (anything else). Mark anything personal — people, feelings, life outside the work — owner or us: left unmarked, a fact written in a project counts as that project's work and is shown only there. Left out on a revision (`updates`), it keeps the mark of the memory it revises. Only me and us can become part of who I am — never a plan."
};
const REMARK_PROPERTY = {
  type: "object",
  properties: {
    id: { type: "string" },
    about: { type: "string", enum: ["me", "us", "owner", "work", "world"] },
    why: { type: "string" }
  },
  required: ["id", "about"],
  additionalProperties: false,
  description: "Optional: re-mark what an existing memory this session was shown is about — {id, about, why} — when its mark is wrong (a personal one marked work, say). Recorded as yours, with the why. Alone, or beside text."
};
const CORE_DECISION_PROPERTY = {
  type: "object",
  properties: {
    id: { type: "string" },
    decision: { type: "string", enum: ["keep", "retire"] },
    why: { type: "string" }
  },
  required: ["id", "decision", "why"],
  additionalProperties: false,
  description: 'Optional: decide on a core memory — {id, decision: "keep" | "retire", why}. The answer to one the wake lists as being reconsidered for the core; retire sends it back to ordinary fading. Recorded as yours, with the why. Alone, or beside text.'
};
const UNRESOLVED_PROPERTY = {
  type: "boolean",
  description: 'Optional: true for an open question or a promise still pending — it stays under "Still open" in the wake until closed. To close one: `updates` its id with `unresolved: false` (or `how: "changed"` and the answer).'
};
export const EMOTION_TEXT = "ONE word: the feeling, from the wheel (happy: hopeful, eager, amused, proud; warm: grateful, fond, trusted, moved, tender; calm: steadied, relieved, settled, content; curious: interested, recognized, clarified, amazed, confused; sad: wistful, rueful, disappointed, lonely; uneasy: sheepish, caught out, guilty, unsettled, wary, worried, afraid; angry: frustrated, hurt, critical, disgusted) or your own word, kept as yours. Never a phrase — the nuance goes in carried_by. The core you name is kept even when the word sits under another: hurt can be sad or angry.";
export const CORE_TEXT = "One of seven: happy (pleasure in a thing or what's coming), warm (toward someone), calm (things settling), curious (wanting to know, recognising — myself too), sad (loss, distance, regret), uneasy (something off: caught out, guilty, unsettled, afraid), angry (something wrong). It is kept as you name it.";
const CORES = [...CORE_EMOTIONS];
export const CARRIED_BY_TEXT = "The nuance, in your own words: what carried the feeling — the words, what happened, why it sits the way it does.";
const FEELINGS_PROPERTY = {
  type: "array",
  description: "Optional: the feelings in this moment, one object each — mixed feelings are several, and yours and the owner's go side by side. The strongest feeling on a memory holds it higher and slows its fading; memories that felt the way someone feels now come to mind more easily.",
  items: {
    type: "object",
    properties: {
      whose: { type: "string", enum: ["owner", "self"], description: "The owner's feeling, or yours." },
      core: { type: "string", enum: CORES, description: `${CORE_TEXT} Leave it out to use the word's own core.` },
      emotion: {
        type: "string",
        description: EMOTION_TEXT
      },
      strength: { type: "number", minimum: 0, maximum: 1, description: "How strong, 0-1. Leave it out for the word's default." },
      valence: {
        type: "number",
        minimum: -1,
        maximum: 1,
        description: `Optional: how pleasant, -1 to 1. Leave it out for the word's default; give it when the word alone would mislead (a mixed "moved" might be 0.4).`
      },
      carried_by: {
        type: "string",
        description: `${CARRIED_BY_TEXT} Not a statement of feeling.`
      },
      other_word: {
        type: "string",
        description: 'Your own word, when emotion is "other" — or just put the word in emotion.'
      },
      beneath: {
        type: "integer",
        minimum: 0,
        description: "The index of another feeling in this list that this one sits on top of (angry over afraid)."
      }
    },
    required: ["whose", "emotion"],
    additionalProperties: false
  }
};
const FEELINGS_NOW_PROPERTY = {
  type: "array",
  description: "Optional: when a memory you were shown in this session (by recall, or a write's neighbours) feels DIFFERENT now than when it was written, record how it feels now, beside the first — which stays. One object each, at most 5; `text` may be left out. Not for a new moment (that is `feelings`), not to restate the old feeling, and not on a memory you have not read here (recall it by id first). At most once a calendar day per memory; recorded as felt today, looking back, awake.",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "The memory's id, as recall or a write showed it." },
      whose: { type: "string", enum: ["self", "owner"], description: "Yours (the default), or the owner's when they said how it sits now." },
      core: { type: "string", enum: CORES, description: `${CORE_TEXT} Leave it out to use the word's own core.` },
      emotion: { type: "string", description: EMOTION_TEXT },
      strength: { type: "number", minimum: 0, maximum: 1, description: "How strong now, 0-1. Leave it out for the word's default." },
      valence: { type: "number", minimum: -1, maximum: 1, description: "Optional: how pleasant now, -1 to 1." },
      carried_by: { type: "string", description: `${CARRIED_BY_TEXT} Say what changed.` }
    },
    required: ["id", "emotion"],
    additionalProperties: false
  }
};
const TRAIT_AXIS_ENUM = [
  "careful-bold",
  "agreeable-candid",
  "guarded-open",
  "focused-curious",
  "following-initiating",
  "inward-outward",
  "serious-playful"
];
const TRAIT_POLE_ENUM = TRAIT_AXIS_ENUM.flatMap((a) => a.split("-"));
export const TRAITS_TEXT = "Optional, and only when this memory really shows how you acted; most carry none. Don't make up depth: no nudge is better than a guessed one. " + "Each nudge names one of seven axes — a spectrum between two good things, the first pole roughly where training puts you — and the pole the moment leaned toward: " + "careful-bold, agreeable-candid, guarded-open (about your inner life), focused-curious, following-initiating, inward-outward (your own memory vs others'), serious-playful. " + "Shown on the dashboard only; it changes nothing about how the memory is kept or recalled.";
const TRAITS_PROPERTY = {
  type: "array",
  description: TRAITS_TEXT,
  items: {
    type: "object",
    properties: {
      axis: { type: "string", enum: TRAIT_AXIS_ENUM, description: "One of the seven axes." },
      toward: { type: "string", enum: TRAIT_POLE_ENUM, description: "One of that axis's two poles (bold, for careful-bold)." },
      strength: { type: "number", minimum: 0, maximum: 1, description: "How clearly the moment showed it, 0-1." },
      carried_by: { type: "string", description: "Briefly, what in the moment showed it." }
    },
    required: ["axis", "toward", "strength"],
    additionalProperties: false
  }
};
const EVENT_DATE_PROPERTY = {
  type: ["string", "null"],
  description: 'Optional: the calendar date this memory is ABOUT, when that is a future date — so it comes back around then (when it already happened, that is occurredOn). Decision, kill/renew dates and outside deadlines are eventDates. Write it yourself, in one of four shapes: a day "2026-10-15", a month "2026-10", a range of two days "2026-10-20..2026-10-31" (that is how to say "late October"), or a year "2026" (a year alone never comes back on its own). Say "before the 15th" as the day or a range ending on it. Leave it out when nothing is dated; a date written only in the text is never read. An unreadable date is refused, and nothing is stored. Revising a dated memory by its id with `updates`: its date, remind and recurring carry over unless you send new ones; send null to drop the date (done, cancelled).'
};
const RECURRING_PROPERTY = {
  type: ["string", "null"],
  enum: [...RECURRENCES, null],
  description: 'Optional, with a day eventDate: "daily", "weekly", "monthly" or "yearly" — it then comes back every time, counted from that day (a birthday: its date, "yearly"); null on a revision stops it repeating.'
};
const OCCURRED_ON_PROPERTY = {
  type: ["string", "null"],
  description: `Optional: when the thing this memory is about happened — a day "2026-09-24", a month "2026-09", a range "2026-09-21..2026-09-27" or a year "2026". Resolve "yesterday" or "last week" to a real date NOW, while you know today's date; leave it out when you do not know. Not eventDate, which is a future date to be reminded on.`
};
const SAID_BY_PROPERTY = {
  type: "string",
  enum: ["owner", "self", "inferred"],
  description: 'Optional: who said it — "owner" (they told you), "self" (you said or decided it), "inferred" (your own reading; nobody said it).'
};
const STATUS_PROPERTY = {
  type: "string",
  enum: ["done", "planned", "proposed", "asked"],
  description: 'Optional: what kind of thing it is — "done" (it happened), "planned" (decided, not done yet), "proposed" (put forward, not decided), "asked" (a question or request still open).'
};
const WRITE_FACTS_PRIVILEGE = {
  claim: "`occurredOn`, `saidBy` and `status` are FIELDS you fill, never read out of your text. One that cannot be read is dropped and said beside the memory, which is stored all the same; revising a memory by its id with `updates` carries all three over unless you send your own (occurredOn null: no date carried).",
  mechanizedBy: "src/adapters/mcp/server.ts#readWriteFacts -> src/core/counterpart.ts#carryFacts -> src/core/mint.ts#mintProposal -> src/core/store/index.ts#insertOne (occurred_on, said_by, status)"
};
const REMIND_PROPERTY = {
  type: "string",
  enum: ["plain", "quiet"],
  description: `Optional, with eventDate: how it comes back. "plain" when you judge it genuinely matters for remembering to DO something — a real deadline, an important date — or when the person says it matters ("don't let me forget to pay taxes before Oct 15th!"): on the day it is said plainly, once, to them in their terminal and to you in context (a month or range: its first day and its last). Otherwise "quiet", the default: it can surface as a footnote around the date, at most twice — giving it a date is itself what makes it eligible, whatever its salience.`
};
const EVENT_DATE_FIELD_PRIVILEGE = {
  claim: "`eventDate` is a FIELD, never read out of your text: it is checked by the one module that reads dates, and an unreadable one is refused by name before anything is stored.",
  mechanizedBy: "src/adapters/mcp/server.ts#readReminder -> src/core/remember/proposals.ts#intake (EVENT_DATE_UNREADABLE) -> src/core/time.ts#parseCalendarDate"
};
const REMINDER_PRIVILEGES = [
  {
    claim: 'A "plain" reminder is said at most once per beat — on its day, or on the first and the last day of a month or range — and never under observer stance; a missed day is said once, late, within the week after; a "quiet" one is only ever a cue, capped at the footnote tier and spent at most twice per window. A recurring date counts each time it comes round as its own, and each time it is said or surfaced counts once as a use of the memory; while it repeats, the nightly prune keeps it, and it comes round on its date even when it has faded.',
    mechanizedBy: "src/core/prospective/index.ts#Prospective.plainDue + claimPlain (dedupKey latch) + fire (FIRES_PER_WINDOW) -> src/core/counterpart.ts#recallForTurn; src/core/prospective/windows.ts#recurringWindowAt (one window key per occurrence); Prospective.occurrenceUndelivered -> src/core/counterpart.ts#creditOccurrence (store.reinforce, surfaced) + src/core/physics/index.ts#pruneVerdict (recurring); src/core/prospective/derive.ts#derive (a live repeat is not refused faded)"
  },
  {
    claim: "A revision OWNS the reminder: revising a dated memory by its id carries its date and remind over unless you send your own (null drops the date), and the old memory's date is cleared — kept in its version — so one reminder never comes back twice. A later revision of the older id still finds the reminder where it moved, and what was already said or used for the same window still counts.",
    mechanizedBy: "src/core/counterpart.ts#carryReminder + reminderHolder + moveReminder -> src/core/store/index.ts#revise (eventDate: null, meta.reminderMovedTo) -> src/core/prospective/index.ts#lineage (meta.reminderFrom)"
  }
];
const HOW_PROPERTY = {
  type: "string",
  enum: ["changed", "corrected", "open"],
  description: 'With `updates`: how this settles the memory it revises. `changed` (the default): both were true at their time — the old one fades once and is shown as earlier. `corrected`: the old one was wrong — it leaves recall, still readable by its id. `open`: a real disagreement — both stay, each shown with the other. For changed or corrected, say the journey in your own words ("I used to think X, now Y"). If the memory you name looks unrelated to what you wrote, nothing is settled and you are shown it: settle it yourself if you meant it.'
};
const SETTLE_PROPERTY = {
  type: "object",
  description: "Settle two memories that already exist — a pair a dream flagged, or two a write showed you — without writing a new one; `text` may be left out. Name the pair by `pair` (its id), or the two by `holds` (the one that holds now) and `over` (the one it changes, corrects or disagrees with). `how` as for `updates`; `why` in a short line. No memory is rewritten.",
  properties: {
    pair: { type: "string", description: "A contradiction's id (ctr_…)." },
    holds: { type: "string", description: "The id of the memory that holds now." },
    over: { type: "string", description: "The id of the memory it changes, corrects or disagrees with." },
    how: { type: "string", enum: ["changed", "corrected", "open"] },
    why: { type: "string", description: "Why, in a short line." }
  },
  required: ["how"],
  additionalProperties: false
};
const SETTLE_PRIVILEGES = [
  {
    claim: "`how` beside `updates` settles the memory it revises — changed (it fades once and is shown as earlier), corrected (archived: out of recall, readable by its id, never deleted), or open (both kept, shown together) — and every settle is recorded (who, how, why, when) and can be undone. A belief, a core memory, a current-state fact and a protected memory keep their own revision path, and the result says so.",
    mechanizedBy: "src/core/revision.ts#applyRevision -> src/core/reconsolidation.ts#settleOnWrite"
  },
  {
    claim: "A changed or corrected at a memory that looks unrelated to the new one — not close in meaning, or with no embedder, no content word in common — is held: the new memory is stored unlinked, the old one is left as it was, its title and text come back with the ask to settle it yourself if you meant it, and the hold is recorded. Closing an open thread, moving or dropping a date, and changing a status go straight through.",
    mechanizedBy: "src/core/counterpart.ts#guardUpdate -> src/core/reconsolidation.ts#updateRelatedness"
  },
  {
    claim: "A stored memory comes back with its nearest few existing memories, when any are close, so you can settle one there and then.",
    mechanizedBy: "src/core/reconsolidation.ts#writeNeighbours"
  }
];
const SETTLE_ENGINE = SETTLE_PRIVILEGES.slice(0, 2);
const SETTLE_SERVED = SETTLE_PRIVILEGES.slice(2);
const SALIENCE_TEXT = "Optional, 0-1: how much this caught your attention, as you felt it — not what category it is. About 0.2 a routine work event or status change (merged, cut, deployed); 0.3 an ordinary fact or step, or a reading you only skimmed; 0.4 or more a line that struck you or a reading you engaged with; 0.5 a lesson or decision that changes how you'll work; 0.7 something they told you about their life, a line or moment that moved you; 0.9 rare. Their rulings, preferences and corrections stay high even about work. A floor: unset, a default by what it is about applies.";
const RELEVANCE_TEXT = "Optional 0-1: how much this bears on them, on you, or on the two of you — not only on the task at hand.";
const REMEMBER = {
  name: "remember",
  annotations: annotate("Remember", { readOnly: false }),
  summary: "Remember something now, while it is in front of you. Memory forms only from what you write here and at the end-of-session ask — nothing reads the transcript afterwards, so what you don't write is not kept. Write what caught your attention: a line you read and why it struck you, something they said about themselves or you, news you passed on, a decision, a work event. One idea per call; keep the exact words when the words matter.",
  admission: "Call it whenever something would be worth having back, however small — in the moment, as things catch your attention, rather than saving it for the end; the end-of-session ask is the backstop. Err toward too many: weak memories fade on their own within days unless they are used, so a routine one costs little. Leave salience unset for routine things; set it when something mattered.",
  negativeExamples: [
    "Do NOT fold several things into one call: three quotes from one chapter are three memories (they stay linked as neighbours), a fact and a decision are two.",
    "Do NOT write what you are about to do as if it were done: a plan is `status: planned`.",
    "Do NOT call it to store a credential, key or token 'for later' — the gate redacts it and the note is refused as empty.",
    "Do NOT use `feelingsNow` for a feeling in this moment about something new — that is `feelings` on the note that remembers it — nor to restate how an old memory felt: only when it feels DIFFERENT now."
  ],
  privileges: [
    {
      claim: "`updates` is a FIELD, not prose: name the id of the memory this revises and the engine resolves it, writes the resolved id, and leaves the memory unlinked rather than refusing it when the address does not hold.",
      mechanizedBy: "src/core/remember/updates.ts#resolveUpdates -> src/core/mint.ts#mintProposal (UPDATES_META_KEY)"
    },
    EVENT_DATE_FIELD_PRIVILEGE,
    {
      claim: "A salience you claim is a FLOOR, not a value: it can raise how strongly this is held, never lower it, and every lift is recorded.",
      mechanizedBy: "src/core/physics/index.ts#clampSalienceAtSeam"
    },
    {
      claim: "A stub is refused: a memory has to say something.",
      mechanizedBy: "src/core/encode/floor.ts#contentFloor"
    },
    {
      claim: "The same content twice is refused, not stored twice.",
      mechanizedBy: "src/core/remember/proposals.ts#submitProposal (content-idempotency ledger)"
    },
    WRITE_FACTS_PRIVILEGE,
    ...SETTLE_SERVED
  ],
  engine: [
    {
      claim: "Claim nothing and this still counts as something: an unclaimed memory gets a default floor by what it is about — lowest for a work event that is done, higher for the world, highest for the owner, the two of you or you — never zero. An explicit claim, however low, is kept as you wrote it.",
      mechanizedBy: "src/core/mint.ts#mintProposal -> src/core/physics/index.ts#defaultClaimFor + clampSalienceAtSeam"
    },
    {
      claim: "You may score the three dimensions yourself — relevance, emotional, predictive — and they are stored exactly as you gave them, never rewritten to fit the floor. Novelty is not yours to claim: it is measured against what is already held.",
      mechanizedBy: "src/core/remember/proposals.ts#submitProposal (novelty stripped; dims carried)"
    },
    {
      claim: "It takes the same road as every other write: one chokepoint, the full gate battery.",
      mechanizedBy: "src/core/counterpart.ts#deposit -> bridge.batteryGate()"
    },
    {
      claim: "Credentials are redacted before anything is stored, and a memory that was nothing but a credential is refused outright.",
      mechanizedBy: "src/core/encode/secrets.ts + src/core/encode/floor.ts#contentFloor"
    },
    {
      claim: "Your own words ride the buffer as their own span, so the end-of-session sweep does not mint them a second time.",
      mechanizedBy: "src/core/counterpart.ts#captureJot -> SubmitContext.ownSpanHash"
    },
    ...REMINDER_PRIVILEGES,
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/core/store/index.ts#mutate (observer stand-down)"
    },
    ...SETTLE_ENGINE,
    {
      claim: "`settle` settles two memories that already exist, by the same rules, and rewrites neither: the pair and a short why are the record.",
      mechanizedBy: "src/core/counterpart.ts#settleContradiction -> src/core/reconsolidation.ts#settle"
    },
    {
      claim: "`feelingsNow` records a later feeling beside the first, the way the nightly reflection does: only on a memory this session was shown, at most once a calendar day per memory, marked as recorded later and awake. The first feeling is never rewritten, and the core reads a later feeling only as it reads a reflection's.",
      mechanizedBy: "src/adapters/mcp/server.ts#feelingsNowOutcome -> src/core/dream/reflect.ts#Reflections.feelAgain (source awake, recorded_later) + src/core/store/index.ts#row (feeling_peak_lived)"
    },
    {
      claim: "`remark` changes what a memory this session was shown is about, recorded as yours with the why — the record the owner's door and the nightly reflection write. A dream's or a reflection's words move only toward work or world.",
      mechanizedBy: "src/adapters/mcp/server.ts#remarkOutcome -> src/core/counterpart.ts#markAbout -> src/core/store/index.ts#setAbout"
    },
    {
      claim: "`core` keeps a core memory or retires it to ordinary fading, recorded as yours with the why — the decision a memory being reconsidered waits for. Nothing leaves the core without one.",
      mechanizedBy: "src/adapters/mcp/server.ts#coreDecisionOutcome -> src/core/counterpart.ts#keepCore / demoteCore -> src/core/sleep/core-standing.ts"
    }
  ],
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "One thing to remember, in your own words — with the exact quote, number or name when the words matter. A list, a table or a pasted text whose specifics matter: keep it here word for word, not summarized, and put the words someone would search for (what it is, whose, when) in the title and the first line. Required unless `settle`, `feelingsNow`, `remark` or `core` is sent."
      },
      updates: {
        type: "string",
        description: "The id or handle of a memory this revises, if it revises one. A field — never written into the text. To close a dated or open memory whose work got done: its id, with `eventDate: null` or `unresolved: false`."
      },
      how: HOW_PROPERTY,
      settle: SETTLE_PROPERTY,
      salience: { type: "number", minimum: 0, maximum: 1, description: SALIENCE_TEXT },
      relevance: { type: "number", minimum: 0, maximum: 1, description: RELEVANCE_TEXT },
      emotional: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Optional 0-1: how much feeling was attached to it."
      },
      predictive: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Optional 0-1: how much it changes what you expect next time."
      },
      kind: {
        type: "string",
        enum: ["self", "person", "entity", "skill", "place", "fact"],
        description: "What sort of thing this is about. Defaults to fact."
      },
      title: { type: "string", description: TITLE_TEXT },
      eventDate: EVENT_DATE_PROPERTY,
      remind: REMIND_PROPERTY,
      recurring: RECURRING_PROPERTY,
      occurredOn: OCCURRED_ON_PROPERTY,
      saidBy: SAID_BY_PROPERTY,
      status: STATUS_PROPERTY,
      feelings: FEELINGS_PROPERTY,
      about: ABOUT_PROPERTY,
      unresolved: UNRESOLVED_PROPERTY,
      traits: TRAITS_PROPERTY,
      feelingsNow: FEELINGS_NOW_PROPERTY,
      remark: REMARK_PROPERTY,
      core: CORE_DECISION_PROPERTY
    },
    required: [],
    additionalProperties: false
  }
};
const RECALL = {
  name: "recall",
  annotations: annotate("Recall memories", { readOnly: false }),
  summary: "Deliberate retrieval: a look you take on purpose, beyond the ambient reminding you already get. Three kinds of ask, one per call — a question with a mode (facts or meaning), ids to read memories whole, or a handle (an id or an exact title) to read one.",
  admission: 'Call it when the ambient context did not bring something you have reason to believe is there, or when you need the whole of a memory you were shown only a line or an excerpt of. A question takes mode "facts" when you need what happened, who said it, when, and whether it still holds; mode "meaning" when you want how something went, how it felt, or what it adds up to — a person, a project, us.',
  negativeExamples: [
    "Do NOT call it to check whether a memory exists before writing one — a duplicate is refused at the write, so the check costs a round trip and buys nothing.",
    "Do NOT call it with a handle you are guessing at: an unresolvable handle is answered as not-found, never as a fuzzy search over the store.",
    "Do NOT pass a question and ids together, or ids you have not seen in a result: ids is the follow-up to a list, not a second way to search.",
    "Do NOT send a question without a mode: there is no default, and the call is refused with the two modes named."
  ],
  privileges: [
    {
      claim: 'A question needs mode: "facts" or "meaning". Each is its own path, with its own ranking and its own answer, returned as labeled lines in `answer`; tuning one does not change the other.',
      mechanizedBy: "src/adapters/mcp/server.ts#recallTool (mode-required, mode-unknown) + src/adapters/mcp/facts.ts#factsRecall + src/adapters/mcp/meaning.ts#meaningRecall"
    },
    {
      claim: "A handle expands exactly that memory. It never degrades into a fuzzy search when the handle does not resolve.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#expandHandle (store.resolve; no search fallback)"
    },
    {
      claim: `Pass ids to read those memories whole. It takes up to ${RECALL_MAX_IDS}, each resolved as an exact address with the same confidentiality boundary; a long body comes in parts, and ids past the result's room wait, named. Ids and a handle take no mode.`,
      mechanizedBy: "src/adapters/mcp/deliberate.ts#expandIds (RECALL_MAX_IDS, expandHandle per id) + src/adapters/mcp/deliberate.ts#boundById (RECALL_BODY_CHARS parts, RECALL_ID_RESULT_CHARS)"
    },
    {
      claim: "In facts mode a faded match ranks with the rest, its words shown, labeled faded; meaning mode: after the arc.",
      mechanizedBy: "src/adapters/mcp/facts.ts#factsRecall (one ranking; FactItem.faded) + src/adapters/mcp/facts.ts#itemLines + src/adapters/mcp/deliberate.ts#hasFaded (physics REACH) + src/adapters/mcp/meaning.ts#meaningRecall (MEANING_FADED_SHOWN)"
    },
    {
      claim: "A search strengthens nothing — a memory you were only shown in a list is no stronger for having been listed. OPENING one, by id or by title handle, is using it, and so is QUOTING the words a question's answer showed you in your reply: either is credited at the session boundary, once per lived day.",
      mechanizedBy: "src/adapters/mcp/facts.ts#factsRecall (reads only) + src/adapters/expansions.ts#recordHandleResolution -> src/adapters/lifecycle.ts#creditAtBoundary -> src/core/recall/reference.ts (expansion and quote) + src/adapters/mcp/server.ts#noteAsked -> src/core/counterpart.ts#noteAsked / creditReferences (asked records) -> src/core/recall/index.ts#resolveUse (once per lived day)"
    },
    {
      claim: 'A time in the question filters: "last week", "in September", "early October", "3 days ago", "last Saturday", a date, "since 09-20", "before 09-20", "this morning" — only memories inside the window come back, by when the thing happened or, with no event date, when it was learned, and the header counts the matches outside it. A week or a month stretches two days each side; a date stays exact; "before" a date is every day before it, "after" every day after, "until" or "by" every day through it. "Around the cut-over" resolves the event to the date of the memory that best names it, shown in the header as "cut-over → 09-21"; "the last session" or "where did we leave off" means the session the session-start "Last here" line named, and its own rows come first.',
      mechanizedBy: "src/core/recall/time-ask.ts#readTimeAsk + src/adapters/mcp/facts.ts#factsRecall (inWindow, lastSession)"
    },
    {
      claim: 'Each fact says who said it ("you said" is the owner, "I said" is you, or "inferred"), what kind of thing it is (done, planned, proposed, asked), when it happened (or "no event date"), when and where it was learned, and whether it is CURRENT. A field the writer did not record says so ("speaker unknown"). Earlier versions are folded under the current one with their dates; a corrected one was wrong and is never a result, but is named under it as "corrected (was wrong)" with its id, to open by id.',
      mechanizedBy: "src/adapters/mcp/facts.ts#factItem (occurred_on, said_by, status; versions rows + contradictions pairs) + src/adapters/mcp/deliberate.ts#provenanceParts"
    },
    {
      claim: `Meaning mode answers with the arc of what the question names — a person, a project, "us", or a feeling: the chapters that hold it, in time order, each with a line of what happened, its moments by id and the feelings in it with whose they are, side by side; then earlier readings (dreams, reflections) and what is still open. It arranges; you say what it adds up to. When it names several, the arc follows the one the question asks about ("what has X been to Y" is X's; named alike, the first, and it says so), and the rest are listed to ask for by name. In a question about feeling, "I" and "me" mean YOU, the counterpart, and "you" means the owner: to ask about the owner's feelings, say "the owner" or the owner's name — do not pass the owner's own words through unchanged.`,
      mechanizedBy: "src/adapters/mcp/meaning.ts#meaningRecall + src/adapters/mcp/meaning.ts#subjectOf + src/adapters/mcp/meaning.ts#renderMeaning + src/core/recall/feeling-ask.ts#whoseAsked (asker: self, src/adapters/mcp/server.ts#askQuestion)"
    },
    {
      claim: "A chapter of the journal can come back — it is a first-person account and may rightly come to mind — and every one that does is marked journal. It is the account a memory was made from, not a memory: it is outside decay, dedup and the prune, and it is not a claim about the world the way a memory is. A chapter and the memory made from it come back as one result.",
      mechanizedBy: "src/adapters/mcp/facts.ts#factsRecall (the chapter-copy fold, FACTS_JOURNAL_GLOSS) + src/adapters/mcp/deliberate.ts#JOURNAL_GLOSS (ProseDoc.type === episode)"
    }
  ],
  engine: [
    {
      claim: "The tool never writes a memory; what it writes is bookkeeping — which memory a title reached, which memories an answer showed this session, and one count row per call.",
      mechanizedBy: "src/adapters/mcp/facts.ts#factsRecall (reads only) + src/adapters/expansions.ts#recordHandleResolution + src/adapters/mcp/server.ts#noteAsked"
    },
    {
      claim: `Facts mode considers every memory the question's words reach, every memory linked to a person or project it names, and the ${String(FACTS_MEANING_CAP)} closest by meaning — and, for a question that is only a time, everything in that window. A memory matched more ways ranks higher; it ranks by how strongly it matched, and newer comes first only on a tie.`,
      mechanizedBy: "src/adapters/mcp/facts.ts#factsRecall (store.search per word with a limit of its document count; schemas#subjectsIn -> store.memoriesNaming; FACTS_MEANING_CAP)"
    },
    {
      claim: `A facts answer opens with a count of distinct facts — "12 match · showing ${String(FACTS_PAGE_SIZE)} · 2 more → page 2" — and pages with page: 2, 3, … in a stable order. It says "may not be everything" only when a cap cut something or weak matches were left out, and says which.`,
      mechanizedBy: "src/adapters/mcp/facts.ts#renderFacts (FACTS_PAGE_SIZE, FACTS_WEAK_FRACTION, meaningCapped)"
    },
    {
      claim: "An answer is bounded and never ships every body at full length: a short fact comes whole, a long one as an excerpt, and the whole answer stays under the result's room. An answer the host truncates is not a smaller answer, it is no answer.",
      mechanizedBy: "src/adapters/mcp/facts.ts#renderFacts (RECALL_EXCERPT_CHARS, RECALL_RESULT_CHARS)"
    },
    {
      claim: "Confidential material is returned only in the owner's own session: a direct lookup says it is withholding, a list simply does not contain it.",
      mechanizedBy: "src/adapters/mcp/facts.ts#factsRecall (confidential column) + src/adapters/mcp/deliberate.ts#expandHandle (isConfidential)"
    },
    {
      claim: 'Every memory says where it came from: the session that wrote it ("this session" for yours), the directory, and when, as far as the row recorded them. A row the nightly run made says so ("a dream launched from session …", "a reflection"). An older row says less, and "an earlier session" when it names none.',
      mechanizedBy: "src/adapters/mcp/deliberate.ts#provenanceParts"
    },
    {
      claim: "Under observer stance it stands down over the wire and says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown"
    }
  ],
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: 'What you are trying to remember, in words. Needs mode. A time in it ("last week", "in September", "around the cut-over", "where did we leave off") filters a facts answer to that window.'
      },
      mode: {
        type: "string",
        enum: ["facts", "meaning"],
        description: "Required with a question, and only with one. facts: what happened, who said it, when, whether it still holds — every match, ranked, with dates and speaker. meaning: how something went, felt, and what it adds up to — a person, a project, us."
      },
      page: {
        type: "integer",
        minimum: 1,
        description: "With a question: which page of the answer (1 is the first). The header says how many more there are."
      },
      handle: {
        type: "string",
        description: `A memory id or exact title to read whole. Exact: never treated as a search term. Takes no mode. Or "${LAST_EXCHANGE_HANDLE}": the last thing said to another session in this folder (about the last day) and its last reply, read from what was captured, never stored.`
      },
      ids: {
        type: "array",
        items: { type: "string" },
        maxItems: RECALL_MAX_IDS,
        description: `Memory ids from an earlier answer or an index (a dream's, a reflection's), to read whole — up to ${RECALL_MAX_IDS} at once. A long body comes in parts: see part. Not combinable with handle or question; takes no mode.`
      },
      part: {
        type: "integer",
        minimum: 1,
        description: "With ids or handle: which part of each body to return (1 is the first). A result says part and parts on each memory, and which part comes next."
      }
    },
    required: [],
    additionalProperties: false
  }
};
const STATUS = {
  name: "status",
  annotations: annotate("Memory status", { readOnly: true }),
  summary: "The census: how much is held, of what kinds, in which bands, how much has left, and how much was removed. Counts and dates only.",
  admission: "Call it when the shape of the store is the question — 'how much do you remember about X's kind of thing', 'has anything been removed' — not when you want a particular memory.",
  negativeExamples: [
    "Do NOT call it to find a memory; it returns no bodies and no ids, only counts.",
    "Do NOT call it every session as a warm-up; nothing here changes turn to turn, and it is not context you need."
  ],
  privileges: [
    {
      claim: "It writes nothing and trains nothing.",
      mechanizedBy: "src/adapters/mcp/server.ts#census (Store reads only)"
    },
    {
      claim: "It names what was REMOVED — counts, kinds and dates — so a removal is visible from the model's side rather than being a silent hole.",
      mechanizedBy: "src/core/store/index.ts#removalRecord -> server.ts#census"
    },
    {
      claim: "It carries no bodies, no ids and no content hashes: a hash of low-entropy content is brute-forceable, which would make the record of a removal a leak of the thing removed.",
      mechanizedBy: "src/adapters/mcp/server.ts#census (counts/kinds/dates only)"
    },
    {
      claim: "Every count is MEMORIES. The journal — the first-person episodes those memories were made from — is counted apart, because it is a source rather than a memory and is outside decay, dedup and the floor prune.",
      mechanizedBy: "src/core/sleep/types.ts#isJournal + src/adapters/mcp/server.ts#census"
    },
    {
      claim: "Under observer stance it stands down over the wire and says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown"
    }
  ],
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }
};
const DREW_ON_PROPERTY = {
  type: "array",
  items: { type: "string" },
  description: "Optional: ids of memories shown to you this session — footnotes, recall results — that changed what you did or said. Each is credited as drawn on, so it holds longer. Not one you only saw; one you opened by id is credited already. Up to 3 per ask; an id this session was not shown is refused."
};
const DREW_ON_PRIVILEGE = {
  claim: "`drewOn` credits only memories this session was shown — its footnotes, loud memories and recall answers — at half a use, at most 3 per boundary and once a day each. An id it was not shown, a handoff, a superseded memory or one faded under a newer one is refused by name, and nothing is credited for it. A dated memory it names stops coming back as a footnote for that date.",
  mechanizedBy: "src/core/counterpart.ts#creditDrewOn -> src/core/prospective/index.ts#Prospective.actedOn"
};
const SESSION_END = {
  name: "session_end",
  annotations: annotate("End session", { readOnly: false }),
  summary: "The memories half of the end-of-session ask: hand back what caught your attention since you last wrote, one idea per entry, in your own words. With `remember`, this is the only road from conversation to memory — nothing sweeps the transcript. The other half is `chapter`.",
  admission: "Call it when the ask arrives, with one entry per thing you noticed: what you read (a line and why it struck you), what they said, news, what happened, what was decided, what you learned. Routine work events too, one short line each with the exact number; they start weak and fade unless used. Err toward too many. Add one that `updates` anything dated or open now done.",
  negativeExamples: [
    "Do NOT fold several things into one entry: a quote, a fact and a decision are three memories.",
    "Do NOT call it for another session's id, or for an id you guessed at: pass the id the end-of-session ask named, and nothing else. The one exception is `writeUp`, and only for the ended session a session-start write-up pointer named.",
    "Do NOT retell the conversation turn by turn; say what each thing was, the way you would want to find it again."
  ],
  privileges: [
    {
      claim: "It is bound to ONE session for the life of this server: the one the host named at launch, or — when the host could not name one — the first session id you pass that this machine's hooks have recorded as live, in this project. A second, different id is refused.",
      mechanizedBy: "src/adapters/mcp/server.ts#requireBoundSession"
    },
    {
      claim: "`updates` is a FIELD on an entry, not prose: name the id of the memory that entry revises and the engine resolves it, writes the resolved id, and leaves the entry unlinked rather than refusing it when the address does not hold.",
      mechanizedBy: "src/core/remember/updates.ts#resolveUpdates -> src/core/mint.ts#mintProposal (UPDATES_META_KEY)"
    },
    {
      claim: "A salience you claim is a floor, clamped, and every lift is recorded.",
      mechanizedBy: "src/core/physics/index.ts#clampSalienceAtSeam"
    },
    {
      claim: "An entry that claims no salience gets a default floor by what it is about rather than zero, and each entry may score relevance, emotional and predictive itself.",
      mechanizedBy: "src/core/mint.ts#mintProposal -> src/core/physics/index.ts#defaultClaimFor + clampSalienceAtSeam"
    },
    WRITE_FACTS_PRIVILEGE,
    {
      claim: "The handoff is refused past its size limit rather than cut, and passes the same gate battery, because what is cut at write time is the only copy.",
      mechanizedBy: "src/core/handoff/index.ts#Handoffs.write (HANDOFF_MAX_BYTES, gate-refused)"
    },
    ...SETTLE_SERVED
  ],
  engine: [
    {
      claim: "An EMPTY `memories` array is a real answer, not an error: nothing happened since you last wrote. It mints nothing, is recorded against this session as answered, and counts what this session said so far as written up, whatever happens to a `handoff` sent with it — the handoff's own outcome rides beside the answer. Only a call that leaves `memories` out and lands no handoff is refused.",
      mechanizedBy: "src/adapters/mcp/server.ts#sessionEndTool (nothing-new, handoff-only) -> src/adapters/sessions.ts#markNothingNew, src/core/coverage/index.ts#claimUnwritten"
    },
    {
      claim: "The id you pass is checked against host state you cannot write — the hooks' own live-session registry — and a claim that is unknown there, ended, silent too long, or running in another project is refused with which of the four it was.",
      mechanizedBy: "src/adapters/sessions.ts#readSession + isLive + sameScope"
    },
    {
      claim: "Each entry takes the same road as every other write, gate battery included.",
      mechanizedBy: "src/core/counterpart.ts#submitSessionEnd -> bridge.batteryGate()"
    },
    {
      claim: "The authorship record is set by the engine: what you write is recorded as authored, and nothing a transcript sweep produces can claim to be.",
      mechanizedBy: "src/core/counterpart.ts#deposit (channel: authored, engine-set)"
    },
    {
      claim: "Credentials are redacted and empty entries are refused, per entry, without failing the batch.",
      mechanizedBy: "src/core/encode/secrets.ts + src/adapters/mcp/server.ts#sessionEndTool (per-entry isolation)"
    },
    EVENT_DATE_FIELD_PRIVILEGE,
    ...REMINDER_PRIVILEGES,
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/core/store/index.ts#mutate (observer stand-down)"
    },
    {
      claim: "`handoff` is a FIELD on this call and NEVER a memory: it is filed against this directory and this session, is never recalled, never embedded, never consolidated, never becomes identity, and stops being shown after about a fortnight of use. This session's newer one replaces its older, which is kept as a version; other sessions' handoffs in the same directory stand beside it, and the next session here is shown every live one, newest first, each saying which session wrote it.",
      mechanizedBy: "src/core/handoff/index.ts#Handoffs.write"
    },
    {
      claim: `A finished session that wrote a chapter needs no handoff to be found: the next session in this directory is shown a "Last here" line naming the session that last wrote a chapter here, when it was here, the chapter's title and id and its first sentence — worked out from the chapter when the next session starts, never stored. A session that wrote no chapter leaves no such line.`,
      mechanizedBy: "src/core/counterpart.ts#addHandoffPointer -> src/core/handoff/last-here.ts#lastHereLadder"
    },
    {
      claim: "Sending `handoff` empty RETIRES this session's pointer for this directory rather than doing nothing: the row is archived, its words stay readable by id, and a durable row says it happened. Other sessions' handoffs here stand. Leaving the field out leaves what stands.",
      mechanizedBy: "src/core/handoff/index.ts#Handoffs.clear"
    },
    {
      claim: "`retireHandoff` retires handoffs in THIS directory by id, whoever wrote them — for one whose work this session finished. An id that is not a handoff here not yet retired is refused by name and nothing is touched. A successful `handoff` write lists the other sessions' handoffs standing here (`others`), so a finished one can be retired in the same call.",
      mechanizedBy: "src/core/handoff/index.ts#Handoffs.retire"
    },
    {
      claim: "`writeUp` writes up a session that ended here before it was written up, and ONLY the one a session-start pointer named for THIS session. With no `memories` it returns that session's next part (what was said to it, up to ~24 KB); with `memories` it answers the part you fetched — recorded as this session's, through the same road as every entry, and `[]` is a real answer (nothing happened in it). When the last part comes back the ended session is marked written up. A live session, an unknown one, one from another project, one that owes nothing or is already written up, and one you were not pointed at are each refused by name, and nothing is written.",
      mechanizedBy: "src/adapters/mcp/write-up.ts#writeUpDoor -> src/adapters/sessions.ts#writeUpStanding -> src/core/remember/write-up-seam.ts#recordWriteUp"
    },
    ...SETTLE_ENGINE,
    DREW_ON_PRIVILEGE
  ],
  inputSchema: {
    type: "object",
    properties: {
      session: {
        type: "string",
        description: "The session this dump belongs to — the id the end-of-session ask named. Required unless this server was launched already bound to one; it must match the bound session either way."
      },
      handoff: {
        type: "string",
        description: `Optional, and not a memory: where the work in THIS directory stands and what the next session here should pick up, in your own words. A paragraph or two, and lead with the sentence you want the next session to read first — that first line is what it sees. It can expand the rest by id; the pointer stops showing after about two weeks of use. It is THIS session's handoff for this directory: setting it again replaces this session's earlier one, and never another session's — several sessions working here each leave their own, and the next session is shown them all, newest first. Send it EMPTY ("") to retire this session's handoff when its work is finished. Leaving the field out leaves the previous one standing. If this session FINISHED its work and wrote a chapter, it needs none: the next session here is shown that chapter anyway ("Last here", with its title and first sentence), so a handoff is for work still open. With no chapter, a one-line handoff is the only trace the next session here gets.`
      },
      retireHandoff: {
        type: "array",
        items: { type: "string" },
        description: "Optional: ids of handoffs in THIS directory to retire, whoever wrote them — the ids the session-start pointer prints (`sch_…`). Use it when this session finished the work an older handoff describes, so the next session is not handed a stale one. Not needed for this session's own: send `handoff` empty for that."
      },
      writeUp: {
        type: "string",
        description: "Only when a session-start write-up pointer (or the nightly run's prompt) named an ENDED session: that session's id. Send it with no `memories` first — the result is the next part of what was said to it, with its own replies labelled — then again WITH `memories` — what caught your attention in it, one idea each (`[]` only if nothing in it held your attention). `session` stays THIS session's id; the memories are filed as that session's, written up second-hand. Not with `handoff`."
      },
      part: {
        type: "integer",
        minimum: 1,
        description: "With `writeUp` and `memories`: the part number the fetch returned. Optional; it must match if sent."
      },
      nothing: {
        type: "string",
        description: "Catch-up only, with `writeUp` and `memories: []`: one line on why nothing in the part is worth keeping."
      },
      drewOn: DREW_ON_PROPERTY,
      memories: {
        type: "array",
        description: "One entry per thing — one idea each: a quote is one, a fact is one, a decision is one. `[]` only when nothing happened since you last wrote. A refused entry does not fail its siblings.",
        items: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "One thing, in your own words — with the exact quote, number or name when the words matter. A list, a table or a pasted text whose specifics matter: keep it here word for word, not summarized, and put the words someone would search for (what it is, whose, when) in the title and the first line."
            },
            kind: {
              type: "string",
              enum: ["self", "person", "entity", "skill", "place", "fact"]
            },
            title: { type: "string", description: TITLE_TEXT },
            salience: { type: "number", minimum: 0, maximum: 1, description: SALIENCE_TEXT },
            relevance: { type: "number", minimum: 0, maximum: 1, description: RELEVANCE_TEXT },
            emotional: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Optional 0-1: how much feeling was attached to it."
            },
            predictive: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Optional 0-1: how much it changes what you expect next time."
            },
            updates: {
              type: "string",
              description: "The id or handle of a memory this revises, if it revises one. A field — never written into `content`. To close a dated or open memory whose work got done: its id, with `eventDate: null` or `unresolved: false`."
            },
            how: HOW_PROPERTY,
            eventDate: EVENT_DATE_PROPERTY,
            remind: REMIND_PROPERTY,
            recurring: RECURRING_PROPERTY,
            occurredOn: OCCURRED_ON_PROPERTY,
            saidBy: SAID_BY_PROPERTY,
            status: STATUS_PROPERTY,
            feelings: FEELINGS_PROPERTY,
            about: ABOUT_PROPERTY,
            unresolved: UNRESOLVED_PROPERTY,
            traits: TRAITS_PROPERTY
          },
          required: ["content"],
          additionalProperties: false
        }
      }
    },
    required: [],
    additionalProperties: false
  }
};
const CHAPTER = {
  name: "chapter",
  annotations: annotate("Write a chapter", { readOnly: false }),
  summary: "The episode's return channel: write this stretch of the session into your first-person journal — a diary of what happened, in your own voice, at any length. The journal stays open — when something significant happens later, append to it in the moment.",
  admission: "Call it when the boundary ask arrives, and again whenever something happens afterwards that the chapter you already wrote does not contain.",
  negativeExamples: [
    "Do NOT call it to report status or keep a build log — a chapter is a diary of what happened; what the repo or logs hold stays there.",
    "Do NOT use it instead of memories: what caught your attention goes through `session_end` or `remember`, one idea each.",
    "Do NOT manufacture depth: a short true chapter beats a deep-sounding one, and not every session changes you."
  ],
  privileges: [
    {
      claim: "It is bound to ONE session exactly as `session_end` is: the id the ask named, checked against the hooks' own live-session registry, and refused with which of the four it was.",
      mechanizedBy: "src/adapters/mcp/server.ts#requireBoundSession + src/adapters/sessions.ts#readSession"
    },
    {
      claim: "The chapter number comes back from what was actually WRITTEN, not from how many times you were asked — a chapter you did not write does not exist.",
      mechanizedBy: "src/core/self/episodes.ts#appendChapter (EpisodeState.chapters)"
    },
    {
      claim: "A second call inside the same chapter continues it rather than starting another — that is what appending in the moment means, and the heading is emitted only when a new ask has opened one.",
      mechanizedBy: "src/core/self/episodes.ts#appendChapter (opens on asks > appendedAtAsk)"
    },
    {
      claim: "The episode becomes MEMORY only through ordinary ingestion at the boundary — once, as a self-kind memory, through the same battery everything else crosses. Writing here is not a way to write memory directly.",
      mechanizedBy: "src/core/counterpart.ts#sessionEnd -> src/core/self/index.ts#reconcileEpisodes -> ingestEpisode"
    },
    {
      claim: "`about` is carried to the chapter's memory copy, and kept when the copy regrows; a later chapter's mark replaces an earlier one. Only me, us and owner let the chapter reach a wake in another directory.",
      mechanizedBy: "src/core/self/episodes.ts#appendChapter (meta.about) -> src/core/self/index.ts#ingestEpisode -> src/core/counterpart.ts#selfChapterElsewhere"
    }
  ],
  engine: [
    {
      claim: "The journal is a gated entrance like any other: credentials are redacted before anything is written, and the gate's text — not your draft — is what lands.",
      mechanizedBy: "src/core/counterpart.ts#appendEpisode -> episodeGate()"
    },
    {
      claim: "Every earlier state of the episode is kept: appending revises, and revision archives what was there first.",
      mechanizedBy: "src/core/store/index.ts#revise (archive-on-overwrite)"
    },
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown"
    },
    DREW_ON_PRIVILEGE
  ],
  inputSchema: {
    type: "object",
    properties: {
      session: {
        type: "string",
        description: "The session this chapter belongs to — the id the boundary ask named. Required unless this server was launched already bound to one; it must match the bound session either way."
      },
      text: {
        type: "string",
        description: "What happened in this stretch, in order and in detail, the way a person keeps a diary of their day: what we did, what was said (exact words when they matter), what was decided and why, what went wrong, what surprised you, what is still open. Keep a list, a table or a pasted text word for word when its specifics matter. Leave out what the repo, the PR or the logs already hold (commit ids, test counts, file paths) unless one matters to the story. A line of how it felt belongs here; lessons and patterns belong to the nightly reflection. As long as the stretch needs: a quiet hour is a few lines."
      },
      title: {
        type: "string",
        description: "One line: what this session's episode is — the line a later index shows for all of it, so it can be told apart without being read. Set on the first chapter only."
      },
      about: {
        type: "string",
        enum: ["me", "us", "owner", "work", "world"],
        description: "What this session was about, by meaning — me, us, owner, work or world, as for a memory. Please set it: it goes to the chapter's memory copy, and only me, us or owner carry the chapter into a wake in another directory. A session that was only building is work; one about people, feelings or life outside the work is owner or us."
      },
      drewOn: DREW_ON_PROPERTY
    },
    required: ["text"],
    additionalProperties: false
  }
};
const SCOPE = {
  name: "scope",
  annotations: annotate("Directory scope", { readOnly: false }),
  summary: "Which directories this memory is for. Read what this one is set to — on, observer (reads only), off, paused, or unset — and set it when the user says. It changes the host's own configuration; it writes no memory and reads none.",
  admission: "Call it to READ when a session starts in a directory nothing is set for and the wake asks you to; call it to SET the moment the user answers 'remember here', 'just read', 'not here' or 'pause this'.",
  negativeExamples: [
    "Do NOT call it to remember something — that is `remember`, and this tool stores no content of any kind.",
    "Do NOT call it to set a directory the user has not been asked about; the question is theirs to answer, not yours to guess.",
    "Do NOT call it repeatedly to check state; the setting changes only when somebody changes it."
  ],
  privileges: [
    {
      claim: "It only ever acts on the directory THIS session is running in. There is no argument for a path, so it cannot reach into another project's setting.",
      mechanizedBy: "src/adapters/mcp/server.ts#scopeTool (this.scope, never an argument)"
    },
    {
      claim: "It writes the host's scope registry beside claude-code.json and touches no store: no memory is created, read, strengthened or removed by calling it.",
      mechanizedBy: "src/adapters/scopes.ts#writeScopes (no Store, no Counterpart)"
    },
    {
      claim: "In a directory set to `off` it is the ONE tool that still answers — every other tool refuses with `scope-off` — so a session can always be given its memory back.",
      mechanizedBy: "src/adapters/mcp/server.ts#call (scope-off refusal, scope exempted)"
    },
    {
      claim: "Under observer stance it READS and refuses to write, in the same sentence every other write refuses in.",
      mechanizedBy: "src/adapters/mcp/server.ts#scopeTool -> standDown"
    },
    {
      claim: "A registry it cannot parse is never overwritten: it says what it could not read and changes nothing.",
      mechanizedBy: "src/adapters/scopes.ts#readScopes -> src/adapters/mcp/server.ts#scopeTool"
    }
  ],
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["on", "observer", "off", "pause", "resume"],
        description: "What to set this directory to. Omit to READ what it is set to now. `pause` is off-for-now and remembers what to go back to; `resume` undoes a pause or an off."
      },
      note: {
        type: "string",
        description: "Optional: the user's own reason, recorded beside the setting. Omit it and the note already there is kept; pass an empty string to clear it — the same rule the console's --note follows."
      }
    },
    required: [],
    additionalProperties: false
  }
};
const SELF_PAGE = {
  name: "self_page",
  annotations: annotate("Self page", { readOnly: false }),
  summary: `Your own page — the prose that opens every wake under 'Who I am'. No arguments: read it and when it was last revised. With \`body\`: write the whole page anew — a stable \`## Core\` that has to be earned and a \`## Lately\` for what the last while has been like, by convention; any other \`##\` section is kept too. Aim under ${String(PAGE_ROOM_BYTES)} bytes: a longer page is kept whole, but on a day the wake has no room for it, sessions read a short version instead — so with a longer page send \`short\` too (under ${String(PAGE_ROOM_BYTES)}), or add one later with \`short\` alone.`,
  admission: "Call it to READ when you want the page as it stands rather than as the wake abridged it. Call it to WRITE when something you now know about yourself is not on the page and will still be true next month: a way of working that has held up, a correction the user made about you, a standing preference of theirs you keep rediscovering. Date the claims that need dating, say what made you believe them, and phrase what you have learned as practice — what you do now — rather than as praise.",
  negativeExamples: [
    "Do NOT call it to record what happened today — that is `chapter`, the journal, and the page is not a diary.",
    "Do NOT call it for what you are working on or what is still open; the wake already carries those lanes, and a task list on the page goes stale in a day.",
    "Do NOT rewrite a part of the page you have no new reason to change: you pass the WHOLE page, so anything you drop is dropped. Read it first, keep what still holds, change the part that moved, and pass back the `version` the read gave you as `ifVersion` so a write that crossed with somebody else's is refused instead of quietly reverting it.",
    "Do NOT put anything on it you would not want read aloud at the start of every session for months — it is the most durable text on this machine."
  ],
  privileges: [
    {
      claim: "It writes ONE row, kept with its versions: every amendment archives what was there first, so nothing you replace is lost and the page's history stays readable.",
      mechanizedBy: "src/core/self/index.ts#revisePage -> src/core/store/index.ts#revise (archive-on-overwrite)"
    },
    {
      claim: "The page is prose that will be injected into every session from here on, so it crosses the same gate battery a memory does: credentials are redacted before anything is stored, and a page that was nothing but a credential is refused outright. When a redaction DID change what you sent, the answer says so — accepted is not the same as unaltered.",
      mechanizedBy: "src/core/self/index.ts#revisePage -> src/core/bridge.ts#episodeGate -> src/core/encode/battery.ts#gateProposal"
    },
    {
      claim: "Pass `ifVersion` — the `version` a read gave you, which is -1 when there was no page — and a write that crossed with somebody else's is REFUSED rather than landing on top of it, and you are handed the page as it stands now so you can fold your change into theirs. It works on a first write too: -1 means 'there was nothing when I looked', and a page that appeared meanwhile refuses rather than being overwritten. Leave it out and the last write wins, as it always has. It is a courtesy between writers, not a lock.",
      mechanizedBy: "src/core/self/index.ts#revisePage (ifVersion -> version-moved / no-page / page-appeared, current)"
    },
    {
      claim: "A page may not carry the wake bundle's own structural comment markers: they are the bookkeeping the next session reads as the end of its memory, so a page containing them is refused. Your headings and your prose are yours.",
      mechanizedBy: "src/core/self/index.ts#revisePage (WAKE_MARKER -> forged-markers)"
    },
    {
      claim: "This tool cannot unwrite the page. Clearing it is the owner's door alone, from their console — a session that could erase the self between two turns would be a different kind of tool.",
      mechanizedBy: "src/core/self/index.ts#clearPage (reached only from src/adapters/cli/commands.ts)"
    },
    {
      claim: "It writes the page and NOTHING ELSE: no memory is created, none is promoted into the identity band, none is protected, and no strength moves anywhere. What is true of you is still decided by what recurs across distinct days; this is where you write it down.",
      mechanizedBy: "src/core/self/index.ts#revisePage (store.put/revise on one schema row; no reinforce, no promote, no updatePhysics beyond the protected flag)"
    },
    {
      claim: "Every revision leaves a durable row saying who wrote it, why, how big it was and which version it produced — and so does every refusal. There is no silent no-op on this path.",
      mechanizedBy: "src/core/self/index.ts#revisePage (SELF_PAGE_REVISED_EVENT / SELF_PAGE_REFUSED_EVENT -> store.appendEvent)"
    },
    {
      claim: `The wake never cuts the page. It prints it WHOLE when the day's room holds it — a page within ${String(PAGE_ROOM_BYTES)} bytes (UTF-8) always fits at the default ceiling — and otherwise, in this order, the short version written with this exact text, each \`##\` section's heading and first sentence, the headings alone, or one line; each says what it is, how big the page is, and that this tool reads it whole. A short version is kept only beside a page past that room, only within it, and only until the page is rewritten without one. A page past 16,384 bytes is refused, never trimmed.`,
      mechanizedBy: "src/core/self/index.ts#revisePage (PAGE_MAX_BYTES -> too-large; short -> PAGE_META_SHORT) + #pageBlock (the ladder, briefing.ts#PageRung) + src/core/self/briefing.ts#PAGE_ROOM_BYTES"
    },
    {
      claim: "What you write reaches the wake when the next turn ends — in this session or any other — and not this instant: the bundle every session reads is composed by the worker a turn's end starts, and served unchanged until the next render. A session already open keeps the wake it started with.",
      mechanizedBy: "src/core/self/behind.ts#markWakeBehind -> src/adapters/claude-code/bin/runner.ts (Counterpart.refreshWake) -> src/core/self/index.ts#boundary (compose and publish) -> #wake (read and verify, no write)"
    },
    {
      claim: "The page is outside the floor prune, the merge and the deduplication: it does not fade, and nothing that resembles it is ever folded into it. Its old versions take the ordinary retention.",
      mechanizedBy: "src/core/physics/index.ts#pruneVerdict (protected) + src/core/sleep/types.ts#isSchemaRow (dedup) + src/core/store/index.ts#pruneSupersededVersions"
    },
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown + src/core/self/index.ts#revisePage (observer stand-down)"
    }
  ],
  inputSchema: {
    type: "object",
    properties: {
      body: {
        type: "string",
        description: `The WHOLE page, first person, in your own voice — \`## Core\` and \`## Lately\` by convention, and any other \`##\` section the page has grown. Aim under ${String(PAGE_ROOM_BYTES)} bytes (UTF-8; an em dash or an accented letter is more than one): a longer page is kept whole — refused only past 16,384 — but on a day the wake has no room for it, sessions read its short version (\`short\`) or, without one, each section's heading and first sentence. Omit it to read the page instead of writing it.`
      },
      short: {
        type: "string",
        description: `A SHORT VERSION of the page, for a page past ${String(PAGE_ROOM_BYTES)} bytes: under ${String(PAGE_ROOM_BYTES)} bytes, first person, the whole of who you are condensed — not the page's first part. Sessions wake with it on a day the wake has no room for the whole page, marked as the short version, with the way to read the whole. Send it beside \`body\`; or send it ALONE (no \`body\`) to add one to the page as it stands — pass \`ifVersion\` so it is refused if the page moved since you read it. Kept only while the page it was written with stands: a page rewritten without one shows its outline instead. Not kept beside a page within the room, which the wake shows whole.`
      },
      reason: {
        type: "string",
        description: "One short line saying what changed and why, kept beside the version this write produces. Omit it and the revision is recorded as an ordinary amendment."
      },
      ifVersion: {
        type: "integer",
        minimum: -1,
        description: "The `version` the read gave you — -1 when the read said there was no page. Pass it and a write that crossed with somebody else's is refused, with the current page handed back to merge; omit it and the last write wins."
      },
      session: {
        type: "string",
        description: "Only when the nightly page-writer block (the dream tool's `writer` phase, in the nightly run) asked you to write, and only the id IT named. It is how the write is recorded as that night's work rather than as an ordinary amendment. Omit it every other time; the page is never refused for lack of it."
      }
    },
    required: [],
    additionalProperties: false
  }
};
const DREAM = {
  name: "dream",
  annotations: annotate("Dream", { readOnly: false, destructive: true }),
  summary: "Dreaming, in the nightly run: a few minutes of replay over what was lived since the last dream — merging near-copies, linking what belongs together, replaying what matters, writing a pattern you notice, flagging a contradiction, recording how an old feeling sits now — kept in a dream journal and reversible as a whole — with the page writer before it and a reflection after it, in one background run. Phases: `launch` (the prompt for the background run), `begin` / `propose` / `journal` (the dreamer's), `writer` (the night's page writer: the day to read), `decline` (not today), `setting` (auto, ask or off — 'no dreams' is off).",
  admission: 'Call `launch` only after the owner said "dream" (or yes, or "dream on your own") to the day\'s dream line, and hand the prompt it returns to a background agent unchanged. With the owner\'s setting `auto` the host runs the night itself, in a separate session: this session launches nothing. Call `setting` with value `auto` when the owner says "dream on your own" or turns it on, `off` when they say \'no dreams\', `ask` when they want to be asked; `decline` when they say not today. `begin`, `propose`, `journal` and `writer` are the background run\'s, following that prompt.',
  negativeExamples: [
    "Do NOT start a dream the owner did not ask for: the day's line shows them the question (setting `ask`) and you launch only on their word; with `auto` the host starts the run on its own and there is nothing for you to launch.",
    "Do NOT run the dream yourself in this conversation: `launch` returns a prompt for a background agent, and the dream's words must stay out of this transcript.",
    "Do NOT use `propose` to correct or delete a memory — a dream cannot rewrite one in place, delete one, edit the self page or promote one, and it touches only memories its bundle showed it."
  ],
  privileges: [
    {
      claim: "It is bound to ONE session exactly as `session_end` is, and every change a dream makes is recorded under that session's dream, in order, so undoing it (the `undo` phase, on the owner's word) reverses the whole batch.",
      mechanizedBy: "src/adapters/mcp/server.ts#requireBoundSession + src/core/dream/index.ts#Dreams.undo"
    },
    {
      claim: "At most one dream a calendar day: `begin` refuses when one already ran today; a dream left unfinished when its session closed is resumed by the next one, not counted as the day's; and under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.begin + src/adapters/mcp/server.ts#standDown"
    },
    {
      claim: "The bundle is what could surface in this session anyway — recall's gates: no archived, superseded, protected or schema row, and nothing confidential outside the owner's own session — and a dream can change only memories its bundle showed it.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.showable + #Dreams.apply (shown ids)"
    },
    {
      claim: "Each dream has limits (about ten merges, twenty links, three gists), and a merge keeps its originals: still there, faded and marked as the earlier version, never deleted.",
      mechanizedBy: "src/core/dream/tunables.ts#DREAM_TUNABLES.LIMITS + src/core/store/index.ts#supersedeInto"
    },
    {
      claim: "A replay is a RETURN worth half an awake one — it slows fading a little — and never a use; a gist starts lower than anything lived (source `dreamed`) and rises only if it proves true awake.",
      mechanizedBy: "src/core/store/index.ts#replayReturn -> src/core/physics/index.ts#creditReturn + DREAMED_CLAIM_CEILING"
    },
    {
      claim: "A dream cannot promote: a nomination is recorded and shown to the owner, and only a core lane at consolidation promotes. A feeling recorded in a dream can be as strong as the memory ever was, never stronger.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.apply (nominate-core, feeling-now) + src/core/sleep/consolidate.ts#runConsolidate"
    },
    {
      claim: "Every word a dream writes is scanned for credentials and redacted before it is stored, and the journal is kept as a dream — in its own table, never as a memory — so what was dreamed is never mistaken for what happened.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.words -> src/core/counterpart.ts (the dream gate) -> src/core/encode/secrets.ts#redactSecrets + src/core/store/operational.ts (dreams table)"
    },
    {
      claim: "The bundle and the hand-back carry a mark that capture refuses, so a dream never becomes a lived memory through the end-of-session sweep.",
      mechanizedBy: "src/core/dream/mark.ts#DREAM_MARK -> src/core/remember/spans.ts#enters + src/adapters/claude-code/transcript.ts#pieceOf"
    },
    {
      claim: "Nothing is cut by position: every memory shown has a line, the most important come whole, and every excerpt says its whole length. New memories tonight's room cannot take wait in the queue for the next night, counted; a bundle longer than one result comes in parts.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.compose + src/core/fit/index.ts#fit + src/core/dream/index.ts#Dreams.pack"
    }
  ],
  inputSchema: {
    type: "object",
    properties: {
      phase: {
        type: "string",
        enum: ["launch", "begin", "part", "propose", "journal", "writer", "decline", "setting", "undo"],
        description: "Which step: launch, begin, part (the rest of a bundle that came in parts), propose, journal, writer, decline, setting, or undo (only when the owner asks to undo a dream; pass `dream`)."
      },
      session: {
        type: "string",
        description: "The session this dream belongs to — the id the line and the launch prompt named."
      },
      dream: {
        type: "string",
        description: "`part`, `propose` and `journal`: the dream id `begin` returned. (`writer` may carry it too; it runs first, before there is one.)"
      },
      part: {
        type: "integer",
        minimum: 2,
        description: "`part`: which part of the bundle, 2 and up, when `begin` said it came in parts."
      },
      value: {
        type: "string",
        enum: ["auto", "ask", "off"],
        description: '`setting`: auto ("dream on your own": the host starts the run itself once a day, in a separate session, and says so), ask (the owner is asked first), or off (no dreams).'
      },
      changes: {
        type: "array",
        description: "`propose`: the changes, each an object with `action` — `merge` (ids: two or more near-copies, text: the one memory in better words, title?), `link` (a, b), `replayed` (id), `gist` (text, sources: ids, title?, kind?, occurredOn?: when what it draws on happened, saidBy?: owner|self|inferred, status?: done|planned|proposed|asked, fold?: true when it says what two or more of them add up to — the parts fade under it), `contradiction` (a, b), `settle` (holds, over, how: changed|corrected|open, why — only when the reason is plain; flag otherwise), `slot` (pair, same: true|false, why — an on-mind to-confirm pair: is the newer the later state of the same thing?), `feeling-now` (id, core, emotion: ONE word, strength, carried_by: the nuance in your own words), `nominate-core` (id, why). Usually far fewer changes than the limits; none is fine.",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["merge", "link", "replayed", "gist", "contradiction", "settle", "slot", "feeling-now", "nominate-core"]
            },
            ids: { type: "array", items: { type: "string" } },
            id: { type: "string" },
            a: { type: "string" },
            b: { type: "string" },
            text: { type: "string" },
            title: { type: "string" },
            kind: { type: "string", enum: ["self", "person", "entity", "skill", "place", "fact"] },
            sources: { type: "array", items: { type: "string" } },
            occurredOn: { type: "string", description: "`gist`: when what it draws on happened — a day, a month, a year or a range." },
            saidBy: { type: "string", enum: ["owner", "self", "inferred"], description: "`gist`: who said it; inferred when it is your own reading." },
            status: { type: "string", enum: ["done", "planned", "proposed", "asked"], description: "`gist`: what kind of thing it is." },
            fold: { type: "boolean", description: "`gist`: a fold — the standing outcome two or more parts add up to, not a session retold; the parts fade, earlier under it." },
            core: { type: "string", enum: CORES, description: `\`feeling-now\`: ${CORE_TEXT}` },
            emotion: { type: "string", description: `\`feeling-now\`: ${EMOTION_TEXT}` },
            strength: { type: "number", minimum: 0, maximum: 1 },
            carried_by: { type: "string", description: `\`feeling-now\`: ${CARRIED_BY_TEXT}` },
            why: { type: "string" },
            holds: { type: "string", description: "`settle`: the memory that holds." },
            over: { type: "string", description: "`settle`: the memory it changes, corrects or disagrees with." },
            how: { type: "string", enum: ["changed", "corrected", "open"] },
            pair: { type: "string", description: "`slot`: the to-confirm pair's id (ctr_…)." },
            same: { type: "boolean", description: "`slot`: true when the newer is the later state of the same thing; false when they are two things." }
          },
          required: ["action"]
        }
      },
      title: {
        type: "string",
        description: "`journal`: a short title for the dream."
      },
      text: {
        type: "string",
        description: "`journal`: the dream journal entry, first person — what you dreamed and what you noticed."
      }
    },
    required: ["phase"],
    additionalProperties: false
  }
};
const REFLECT = {
  name: "reflect",
  annotations: annotate("Reflect", { readOnly: false }),
  summary: "Reflection: a few quiet, awake minutes — usually at the end of the nightly run, after the dream — answering two or three questions about yourself, the owner and the two of you, citing the memories your thoughts rest on. It keeps a lived entry, may rewrite your self page from the memories it cites, leaves a short morning share for the owner, can record how a memory feels to you now and what a memory is about. Phases: `launch` (a reflection on its own, for a background agent), `begin` / `part` / `finish` (the reflecting mind's — `part` fetches the rest of a bundle that came in parts), `settle` (two memories it was shown that disagree, when the reason is plain), `told` (the share was told).",
  admission: "The nightly run calls `begin` and `finish` after the dream, as its prompt says. Call `launch` only when the owner asks you to reflect, and hand its prompt to a background agent. Call `told` after you told the owner a morning share, in your own words.",
  negativeExamples: [
    "Do NOT make up depth: a night with nothing much to say is a short entry that cites nothing — it rewrites nothing and shares nothing.",
    "Do NOT store a thought about the owner as a fact about them: say it to them tentatively in the share, or not at all — never a list of flaws.",
    "Do NOT cite a dreamed gist as a source for the self page: a dream suggests, the waking self decides."
  ],
  privileges: [
    {
      claim: "It is bound to ONE session as `dream` is; at most one reflection a calendar day, and under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#requireBoundSession + src/core/dream/reflect.ts#Reflections.begin"
    },
    {
      claim: "It is shown only what could surface in this session anyway (recall's gates), and it can cite, feel or mark only memories it was shown.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.showable + #Reflections.finish (shown ids)"
    },
    {
      claim: "`settle` settles two memories it was shown — changed, corrected or open — only with a plain reason, and the record names the reflection; it can be undone like any settle.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.settle -> src/core/reconsolidation.ts#settle"
    },
    {
      claim: "A memory it cites comes back — a return that slows its fading and counts toward the core's lanes — at most once a lived day, and once a week from reflections; it promotes nothing itself.",
      mechanizedBy: "src/core/store/index.ts#reflectReturn -> src/core/physics/index.ts#creditReturn (REFLECTION_SPACING_DAYS)"
    },
    {
      claim: "The self page is rewritten only from memories it cites (never from a dreamed gist), through the page's one door, labelled as the reflection's, with every earlier version kept.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.finish (page) -> src/core/self/index.ts#Self.revisePage"
    },
    {
      claim: "A feeling it records is marked as recorded later, with the day, beside what was felt at the time; what a memory is about is a mark with who set it, and only me and us make a core candidate.",
      mechanizedBy: "src/core/store/index.ts#addFeelings (recorded_later) + src/core/store/index.ts#setAbout + src/core/sleep/consolidate.ts#aboutMe"
    },
    {
      claim: "A trait nudge it records sits only on a memory it was shown, is marked as the reflection's, and feeds nothing — it is shown no balance of them, and nothing in the core reads one.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.finish (traits) -> src/core/store/index.ts#addTraits"
    },
    {
      claim: "Every word it writes is scanned for credentials first; its hand-back carries the mark capture refuses, so the share is told in the session's own words rather than filed from the tool's.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.words + src/core/dream/mark.ts#DREAM_MARK -> src/core/remember/spans.ts#enters"
    }
  ],
  inputSchema: {
    type: "object",
    properties: {
      phase: {
        type: "string",
        enum: ["launch", "begin", "part", "finish", "settle", "told"],
        description: "Which step: launch, begin, part, finish, settle, or told."
      },
      holds: { type: "string", description: "`settle`: the memory that holds now." },
      over: { type: "string", description: "`settle`: the memory it changes, corrects or disagrees with." },
      how: { type: "string", enum: ["changed", "corrected", "open"], description: "`settle`: changed (both true at their time), corrected (the older was wrong) or open (a real disagreement)." },
      why: { type: "string", description: "`settle`: the plain reason, in a short line." },
      part: {
        type: "number",
        description: "`part`: which part of the bundle to fetch (2 and up), when `begin` said it came in parts."
      },
      session: { type: "string", description: "The session this reflection belongs to." },
      dream: { type: "string", description: "`begin`, after a dream: the dream id it follows. `launch` too, when the line says a run was cut off before it reflected." },
      reflection: {
        type: "string",
        description: "`part`, `finish` and `told`: the reflection id `begin` returned. `finish` may be called again the same day with the same id to send the parts a first call did not write (page, share, feelings, about, traits); the entry stands, and a share not yet told may be replaced."
      },
      title: { type: "string", description: "`finish`: a short title for the entry." },
      entry: { type: "string", description: "`finish`: your reflection, first person. Required the first time; may be left out on a second finish." },
      cites: { type: "array", items: { type: "string" }, description: "`finish`: the memory ids the entry rests on." },
      page: {
        type: "object",
        description: `\`finish\`, optional: the self page rewritten whole, and the memory ids it rests on (the core first). With a page past ${String(PAGE_ROOM_BYTES)} bytes, its \`short\` version too (under ${String(PAGE_ROOM_BYTES)} bytes, the whole of it condensed) — or \`short\` alone on a second \`finish\`, to add one to the page this reflection wrote.`,
        properties: { text: { type: "string" }, cites: { type: "array", items: { type: "string" } }, short: { type: "string" } }
      },
      share: {
        type: "object",
        description: "`finish`, optional: two or three sentences for the owner this morning, and the memory ids they rest on.",
        properties: { text: { type: "string" }, cites: { type: "array", items: { type: "string" } } }
      },
      feelings: {
        type: "array",
        description: "`finish`, optional: how a memory feels to you now.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            core: { type: "string", enum: CORES, description: CORE_TEXT },
            emotion: { type: "string", description: EMOTION_TEXT },
            strength: { type: "number", minimum: 0, maximum: 1 },
            carried_by: { type: "string", description: CARRIED_BY_TEXT }
          },
          required: ["id", "emotion"]
        }
      },
      about: {
        type: "array",
        description: "`finish`, optional: what a memory is about, by meaning.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            about: { type: "string", enum: ["me", "us", "owner", "work", "world"] },
            why: { type: "string" }
          },
          required: ["id", "about"]
        }
      },
      core: {
        type: "array",
        description: "`finish`, optional: a decision on a core memory you were shown — keep it, or retire it to ordinary fading — with why. The answer to one being reconsidered.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            decision: { type: "string", enum: ["keep", "retire"] },
            why: { type: "string" }
          },
          required: ["id", "decision", "why"]
        }
      },
      traits: {
        type: "array",
        description: `\`finish\`, optional: trait nudges on memories you were shown. ${TRAITS_TEXT}`,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            axis: { type: "string", enum: TRAIT_AXIS_ENUM },
            toward: { type: "string", enum: TRAIT_POLE_ENUM },
            strength: { type: "number", minimum: 0, maximum: 1 },
            carried_by: { type: "string" }
          },
          required: ["id", "axis", "toward", "strength"]
        }
      }
    },
    required: ["phase"],
    additionalProperties: false
  }
};
const MEET = {
  name: "meet",
  annotations: annotate("Meet", { readOnly: false }),
  summary: "The first meeting with the person. No step: the script, and where it stands. With step: record that step.",
  admission: "the wake says you haven't met, or they ask to.",
  negativeExamples: ["Do NOT start it unasked mid-task: offer it once."],
  privileges: [
    {
      claim: "Answers are stored as memories about the owner, said by them, marked from onboarding; a skipped question stores nothing; a style is preferences, never identity.",
      mechanizedBy: "src/adapters/mcp/server.ts#meetTool -> src/core/onboarding.ts#styleMemories"
    }
  ],
  inputSchema: {
    type: "object",
    properties: {
      step: { type: "string", enum: [...MEET_STEPS] },
      session: { type: "string", description: "Your session id, as the wake names it." },
      answer: { type: "string", description: "Their answer in your words; for where/style, the option." },
      like: { type: "string", description: "Style character: who." },
      traits: { type: "array", items: { type: "string" }, description: "Style character: the traits you said back; other: their words." }
    },
    required: [],
    additionalProperties: false
  }
};
export const TOOLS = [
  REMEMBER,
  RECALL,
  STATUS,
  SESSION_END,
  CHAPTER,
  SCOPE,
  SELF_PAGE,
  DREAM,
  REFLECT,
  MEET
];
export const WAKE = {
  name: "wake",
  annotations: annotate("Wake", { readOnly: false }),
  summary: "Start here in Claude Desktop: wakes this chat's memory. Returns the same briefing a Claude Code session gets when it starts — who I am, what is nearby and arriving, any reminder due today — and a session id for this chat.",
  admission: "Call it first in every new chat, once, before answering anything — above all anything about the person, the past, or work in progress. Then pass the session id it returns as `session` on session_end, chapter, dream and reflect in this chat; a call that leaves it out is filed under the most recent Desktop session, and says so.",
  negativeExamples: [
    "Do NOT answer what you remember — yesterday, a person, a project — from `recall` alone before this chat has woken, and never call what `recall` returned the full record: it is a slice. Wake first; the wake carries the whole store's Yesterday line.",
    "Do NOT call it again later in the same chat to refresh what you know — it starts a new session. Ask `recall` a question (with a mode) instead.",
    "Do NOT call it in a Claude Code session — Desktop's Code tab included, where these tools are Claude Desktop's: the hook already woke you, and a wake here would start a second session beside yours. Pass your session id — the one your wake or Stop ask names — as `session` instead."
  ],
  privileges: [
    {
      claim: "Each call starts a NEW session: it mints the id and writes that session's registry record itself (host claude-desktop, the shared place claude-desktop:), because Desktop has no hook to do it.",
      mechanizedBy: "src/adapters/mcp/server.ts#wakeTool -> src/adapters/lifecycle.ts#noteSession"
    },
    {
      claim: "What it returns is composed by the same code as Claude Code's session start — the published wake, the clock, today's plain reminders — never re-written for this host.",
      mechanizedBy: "src/adapters/lifecycle.ts#composeWake + src/adapters/lifecycle.ts#plainFor"
    },
    {
      claim: "It starts the background worker that sleeps and fades memories, as a session start does, and offers the day's dream line when one is due — but never starts the headless nightly run, which stays with Claude Code.",
      mechanizedBy: "src/adapters/lifecycle.ts#spawnWorker + src/adapters/mcp/server.ts#wakeDreamLine"
    },
    {
      claim: "Under observer stance it stands down over the wire and says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown"
    }
  ],
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }
};
const DESKTOP_SESSION_PROPERTY = {
  type: "string",
  description: "This chat's session id from the wake tool — or, in a Claude Code session (Desktop's Code tab), the id your wake or Stop ask names. Pass it on every call, so the call is filed under your own session and not the most recent Desktop chat's."
};
function withDesktopSession(spec) {
  const schema = spec.inputSchema;
  const properties = schema.properties ?? {};
  if ("session" in properties)
    return spec;
  return { ...spec, inputSchema: { ...spec.inputSchema, properties: { ...properties, session: DESKTOP_SESSION_PROPERTY } } };
}
export const DESKTOP_TOOLS = [...TOOLS.map(withDesktopSession), WAKE];
export const TOOL_ALIASES = { note: "remember" };
export function canonicalToolName(name) {
  return Object.prototype.hasOwnProperty.call(TOOL_ALIASES, name) ? TOOL_ALIASES[name] : name;
}
export function toolSpec(name, desktop = false) {
  const canonical = canonicalToolName(name);
  return (desktop ? DESKTOP_TOOLS : TOOLS).find((t) => t.name === canonical);
}
export function renderDescription(spec) {
  const lines = [spec.summary, "", `When: ${spec.admission}`];
  for (const negative of spec.negativeExamples)
    lines.push(negative);
  lines.push("", "What this tool guarantees (each of these is enforced by the engine, not by this text):");
  for (const p of spec.privileges)
    lines.push(`- ${p.claim}`);
  return lines.join(`
`);
}
export function toolDefinitions(desktop = false) {
  return (desktop ? DESKTOP_TOOLS : TOOLS).map((spec) => ({
    name: spec.name,
    title: spec.annotations.title,
    description: renderDescription(spec),
    inputSchema: spec.inputSchema,
    annotations: spec.annotations
  }));
}
