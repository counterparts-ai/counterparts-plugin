/**
 * The flow page's map: COUNTERPARTS' own architecture as a diagram, and the
 * rule that every durable event has a place on it.
 *
 * Three things live here and nowhere else:
 *
 *   1. **The nodes** — one per module (plus the two seams a reader can see: the
 *      session the host holds, and the crash-fallback sweep). Each carries what
 *      it does in plain language and its BRAIN ANALOG, quoted in substance from
 *      the module's own `CONTRACT.md` §2 — including where the analogy
 *      deliberately breaks, because a comparison that only says where it holds
 *      is advertising (constitution line 12: deviations are named).
 *   2. **The edges** — the pipeline, drawn once. `dotted` marks the path that is
 *      supposed to be silent: the crash fallback (`remember/fallback.ts`).
 *   3. **The event→node map**, with a TOTALITY rule of exactly the kind
 *      `registries.ts` keeps for the axes: `EVENT_NODE` is declared
 *      `satisfies Record<DurableEventName, NodeKey>`, so a durable event added
 *      to the core fails `tsc` HERE until someone decides which part of the
 *      machine it belongs to. A particle with nowhere to land would otherwise
 *      just never be drawn, which is the silent-starvation failure again
 *      (scar §2.17).
 *
 * Geometry lives here too — normalized 0..1 coordinates — so the page is a dumb
 * renderer and the diagram's shape is reviewable as data.
 */
import type { DurableEventName } from "../registries.js";

export const NODE_KEYS = [
  "session",
  "spans",
  "remember",
  "sweep",
  "encode",
  "store",
  "physics",
  "recall",
  "associate",
  "schemas",
  "prospective",
  "sleep",
  "wake",
  "self",
] as const;

export type NodeKey = (typeof NODE_KEYS)[number];

export interface FlowNode {
  readonly key: NodeKey;
  readonly label: string;
  /** The one-line subtitle under the title in the box. */
  readonly sub: string;
  /** Plain language: what this part of the machine actually does. */
  readonly what: string;
  /** Where the brain comparison holds. */
  readonly analog: string;
  /** Where it deliberately breaks. Never omitted; "none named" is a value. */
  readonly breaks: string;
  /** Normalized 0..1 box, laid out left-to-right along the pipeline. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Accent colour role the page maps to a CSS variable. */
  readonly accent: "cyan" | "purple" | "amber" | "teal";
}

/**
 * The one-line honest answer for a node that CANNOT light, because nothing in
 * the core writes a durable event for it. Not a gap in the diagram — a fact
 * about the log, said out loud rather than left as an empty panel (scar §2.4).
 */
export const NO_EVENT_OF_ITS_OWN: Partial<Record<NodeKey, string>> = {
  spans: "Turn capture is silent by design — a captured turn writes no durable event, only a row in the buffer. What it did shows as the buffer's own depth, not as a line in the log.",
  // ASSOCIATE HAD AN ENTRY HERE until 2026-09-17, and the reasoning in it was
  // the trap: "an edge IS its own record" is true of an edge that exists, and
  // says nothing at all about a wiring pass that wrote none. The buffer was
  // filled in the hook process and flushed in the detached worker, so nothing
  // was ever published — and with no event of its own, no surface could tell
  // that from a graph with nothing to add. The hook now leaves its deltas on
  // disk and the worker applies them; `associate.flush` is that apply's row,
  // and the node's.
  // PROSPECTIVE HAD AN ENTRY HERE until 2026-09-20, and it was the associate
  // trap again: "the rows are the record" is true of a window that exists and
  // says nothing about a firing that did or did not happen. `fires` is a
  // counter and `last_fired_day` a single day, so the store could say a window
  // had ever fired and never when, why one did not, or which brake held — and
  // the owner's fourteen windows carried v1 counters with `last_fired_day` null
  // on every one. `prospective.fire` and `prospective.fire.refused` are the
  // node's rows now.
  physics: "Physics writes no event of its own, ever. It is arithmetic; the phase that ACTS on a verdict is what records it — so a promotion reads as sleep's line, not as physics'.",
  self: "Identity and episodes are written through the store like anything else. The one name that ever reached the log from here is historical.",
};

/**
 * THE THIRD ABSENCE WORD — a slot that is EMPTY today, and kept for the reason
 * it was built.
 *
 * `(none yet)` means asked, and the answer is zero. `(never run)` means never
 * asked. Both were wrong for ENCODE, which rendered `(never run)` beside STORE's
 * `143 memories held` on the same diagram — a flat contradiction to anyone who
 * did not click it. The gate battery HAD run, on all 143; it simply wrote a
 * durable record on one of its two paths. The crash-sweep path recorded what it
 * gated because nobody watched it happen; the authored path was gated in line,
 * in front of the person who asked, and wrote nothing durable.
 *
 * **That is no longer true, and this entry went away with it (2026-09-05).**
 * `gate.deposit` is the authored door's own row — the same battery, the same
 * content-by-reference rules, one row per deposit that reached it — so both of
 * encode's paths are in the log and the node has an ordinary count to show.
 * Replay §2a, which named this as the place it would change, is closed.
 *
 * The map stays because the WORD is still needed: a node whose work is real but
 * deliberately unrecorded must say so in its own words rather than borrow an
 * absence word that means something else. Keyed separately from
 * `NO_EVENT_OF_ITS_OWN` for the same reason as before — a node with an event
 * name is not a node without events. Empty is the honest state of it now.
 */
export const UNLOGGED_PATH: Partial<Record<NodeKey, string>> = {};

export const FLOW_NODES: readonly FlowNode[] = [
  {
    key: "session",
    label: "SESSION",
    sub: "you and the assistant",
    what: "The live conversation in the host. Three things cross this line: the wake bundle arrives at the start, recall arrives quietly during, and the turns leave for the buffer as they happen.",
    analog: "The present moment — working memory, holding what is being said right now.",
    breaks: "A session ends absolutely. Human working memory has no boundary event; here the boundary is the most important moment in the day, because it is when the author writes.",
    x: 0.02,
    y: 0.42,
    w: 0.13,
    h: 0.15,
    accent: "teal",
  },
  {
    key: "spans",
    label: "SPANS BUFFER",
    sub: "turns, held briefly",
    what: "Every turn is captured to a buffer as it happens. Nothing here is memory yet — it is raw material with a cursor, and its only real customer is the crash fallback.",
    analog: "The few seconds of echoic hold before anything is encoded.",
    breaks: "The brain's buffer decays in seconds and cannot be replayed. This one persists on disk until a boundary claims it, which is the whole reason a crashed session can still be recovered.",
    x: 0.02,
    y: 0.68,
    w: 0.13,
    h: 0.13,
    accent: "teal",
  },
  {
    key: "remember",
    label: "REMEMBER",
    sub: "the authored door",
    what: "The front door: what the assistant itself writes at a boundary (session_end), in the moment (remember), and as the day's own chapter. The author decides what was learned; nothing here is scraped.",
    analog: "Hippocampal encoding — binding a lived experience into a durable trace while its context is still present.",
    breaks: "In humans encoding is involuntary. Here it is authored, and an author can decline to write where a hippocampus cannot. The mitigation is that the ask is ambient and its coverage is measured, not assumed.",
    x: 0.20,
    y: 0.40,
    w: 0.15,
    h: 0.17,
    accent: "cyan",
  },
  {
    key: "sweep",
    label: "CRASH SWEEP",
    sub: "the fallback, normally silent",
    what: "For the day the author never got to write. It reads the buffer of a session that crashed, chunks it, and puts each chunk through the gate battery. Its ordinary answer is 'nothing crashed'.",
    analog: "Nothing in the brain corresponds to this. It is an engineering backstop.",
    breaks: "The whole node is a named deviation: memory that recovers from a process crash is not a property biology has or needs.",
    x: 0.20,
    y: 0.76,
    w: 0.15,
    h: 0.13,
    accent: "amber",
  },
  {
    key: "encode",
    label: "ENCODE",
    sub: "secrets · precision · salience · novelty",
    what: "The bouncer. Strips secrets, refuses what is too thin to keep, scores how much this matters (relevance, feeling, predictive value) and how new it is against what is already believed. Both paths leave a durable record of what the gates did: `gate.chunk` for a swept chunk, `gate.deposit` for something the author wrote.",
    analog: "Attention selecting what is worth encoding, plus amygdala tagging that marks emotional material for preferential consolidation.",
    breaks: "The secrets gate has no biological analog — the brain has no interlock that refuses to encode a credential. It is a deliberate, non-ablatable addition.",
    x: 0.40,
    y: 0.40,
    w: 0.15,
    h: 0.17,
    accent: "amber",
  },
  {
    key: "store",
    label: "STORE",
    sub: "three boxes",
    what: "Prose markdown you can open in any editor (canonical), one small SQLite of operational state (canonical), and a cache of search indexes that can always be thrown away and rebuilt.",
    analog: "None, deliberately. This is the engineering floor the brain does not have.",
    breaks: "Exactness where the brain is reconstructive. Human memory has no separable substrate; conflating the two is how the first version ended up with canonical state spread across half a dozen sidecars.",
    x: 0.60,
    y: 0.38,
    w: 0.16,
    h: 0.21,
    accent: "cyan",
  },
  {
    key: "physics",
    label: "PHYSICS",
    sub: "one page of arithmetic",
    what: "How strong a memory is today, how fast it fades, how much a real use reinforces it, how much accumulated pressure it takes to revise a belief. No opinions, no model calls.",
    analog: "Synaptic plasticity and the forgetting curve: potentiation from use, downscaling from disuse, consolidation moving a trace from episodic to semantic.",
    breaks: "Three named deviations: identity-band memories do not decay (flashbulb memories do fade in humans); traces never blend, so there is no substrate confabulation; and only a retrieval the assistant actually USED resets the curve, where in humans every retrieval reconsolidates.",
    x: 0.60,
    y: 0.68,
    w: 0.16,
    h: 0.13,
    accent: "purple",
  },
  {
    key: "recall",
    label: "RECALL",
    sub: "cues → activation → gate",
    what: "Turns what you just said into cues, activates what they reach, and judges each candidate against this turn's own background. Most of what surfaces arrives as a footnote; rarely, one memory speaks up.",
    analog: "Cue-driven spreading activation with a relevance gate, and behavioural-relevance tagging afterwards.",
    breaks: "Surfacing is judged relative to this turn's own background distribution, not against an absolute threshold — where a design wants 'if x > threshold', suspect a flattened gradient. And only a retrieval the reply actually used reconsolidates.",
    x: 0.40,
    y: 0.12,
    w: 0.15,
    h: 0.17,
    accent: "purple",
  },
  {
    key: "associate",
    label: "ASSOCIATE",
    sub: "what fires together, wires",
    what: "Memories that come up together get an edge between them, and activation spreads along those edges at the next recall.",
    analog: "Hebbian plasticity — cells that fire together wire together — plus spreading activation through the resulting network.",
    breaks: "Credit is retrospective and graded: full only when the reply actually used the memory, weak when it surfaced unused, zero for the merely footnoted — where in humans every retrieval trains. Homeostasis is structural (an edge cap, a bounded outgoing weight) rather than metabolic.",
    x: 0.82,
    y: 0.66,
    w: 0.15,
    h: 0.13,
    accent: "teal",
  },
  {
    key: "schemas",
    label: "SCHEMAS",
    sub: "entities · beliefs · pressure",
    what: "What is believed about people and things. Entities are born by mention; each carries beliefs and current facts. A belief is revised only when accumulated pressure crosses its bar, and the challenge log survives.",
    analog: "Schema formation and semantic memory: repeated episodes abstract into a structure that new experience is compared against, which is what makes prediction error possible.",
    breaks: "Beliefs never blend into each other. Generalization is only ever an explicit, provenance-carrying revision — biology's interference and source confusion are the bugs, not the architecture.",
    x: 0.82,
    y: 0.38,
    w: 0.15,
    h: 0.17,
    accent: "purple",
  },
  {
    key: "prospective",
    label: "PROSPECTIVE",
    sub: "intentions, held",
    what: "Future commitments that resurface on their own when their moment arrives, rather than sitting in a list you have to check.",
    analog: "Time-based prospective memory — the intention that comes back by itself when the moment comes.",
    breaks: "Human prospective memory fails toward forgetting; this fails toward tact. A system that surfaces every stored commitment at first retrievability is a task queue wearing memory's clothes. Hold debts, lose deadlines.",
    x: 0.82,
    y: 0.86,
    w: 0.15,
    h: 0.11,
    accent: "amber",
  },
  {
    key: "sleep",
    label: "SLEEP",
    sub: "decay · prune · consolidate · dedup",
    what: "Housekeeping at the boundary: fade what was not used, delete at the floor, promote what has proven itself over separate days, merge duplicates, then re-render the briefing. Pure arithmetic, no model calls.",
    analog: "Systems consolidation during sleep: replay, schema integration, synaptic downscaling, and the pruning of what was never used.",
    breaks: "It runs as boundary-time micro-sleeps rather than one nightly block, because a session end is when the material is freshest and the host is idle. And it PRUNES at the floor: human forgetting is loss of access, not deletion — this deletes, loudly, on physics' verdict alone.",
    x: 0.60,
    y: 0.10,
    w: 0.16,
    h: 0.17,
    accent: "cyan",
  },
  {
    key: "wake",
    label: "WAKE",
    sub: "the briefing, waiting",
    what: "The bundle the next session opens with: who this has been, in its own words, in lanes with a byte budget the host reports. Rendered without a model.",
    analog: "Re-inhabiting yourself on waking — the self-schema you resume rather than look up.",
    breaks: "A human wakes into their self continuously. Here the briefing is composed at one moment and handed over at another, so its arrival can be verified — and is, by a sentinel.",
    x: 0.20,
    y: 0.10,
    w: 0.15,
    h: 0.17,
    accent: "cyan",
  },
  {
    key: "self",
    label: "SELF",
    sub: "identity · episodes",
    what: "The autobiography: identity elements that strength earned or the owner made permanent, and the episode journal written in chapters, in the first person, at the boundary.",
    analog: "Autobiographical memory and the narrative self — episodic replay feeding a stable self-schema.",
    breaks: "Humans never author their episodes; here it is a ritual, which is the authorship thesis. Identity-band memories do not decay here. And transcript-derived self-reinforcement is deliberately not copied — it is the rumination pathway, a documented bug of human cognition rather than architecture.",
    x: 0.82,
    y: 0.10,
    w: 0.15,
    h: 0.17,
    accent: "purple",
  },
];

export interface FlowEdge {
  readonly from: NodeKey;
  readonly to: NodeKey;
  /** The crash path, drawn dotted: it is supposed to be silent. */
  readonly dotted?: boolean;
  /** Bow direction: 0 straight, negative arcs above, positive below. */
  readonly bow?: number;
  readonly label?: string;
}

export const FLOW_EDGES: readonly FlowEdge[] = [
  { from: "session", to: "spans", label: "every turn" },
  { from: "session", to: "remember", label: "what was learned" },
  { from: "spans", to: "sweep", dotted: true, label: "only if it crashed" },
  { from: "sweep", to: "encode", dotted: true },
  { from: "remember", to: "encode" },
  { from: "encode", to: "store", label: "what got in" },
  { from: "store", to: "physics" },
  { from: "store", to: "schemas" },
  { from: "store", to: "associate" },
  { from: "store", to: "prospective" },
  { from: "store", to: "self" },
  { from: "store", to: "recall", label: "candidates" },
  { from: "associate", to: "recall", bow: 0.3, label: "spreads" },
  { from: "recall", to: "session", label: "footnotes · one loud" },
  { from: "store", to: "sleep", label: "at every boundary" },
  { from: "sleep", to: "store", bow: -0.18 },
  { from: "self", to: "wake", bow: -0.35, label: "composes" },
  { from: "sleep", to: "wake", label: "re-renders" },
  { from: "wake", to: "session", label: "at session start" },
];

/**
 * EVENT → NODE. **Exhaustive by type**, the way `BAND_ORDER` and
 * `DURABLE_EVENTS` are: a durable event the core learns to write has to be given
 * a home here before `tsc` will pass, so no particle is ever dropped on the
 * floor. Where an event belongs to the phase that RECORDED it rather than to the
 * module whose arithmetic decided it, that is deliberate and noted.
 */
export const EVENT_NODE = {
  // The sleep cycle's four durable records. `band.promoted` and
  // `band.transition` are physics' verdicts, but sleep is what wrote them —
  // and the honest answer to "who did this" is the phase, not the arithmetic.
  "band.promoted": "sleep",
  "band.transition": "sleep",
  "memory.pruned": "sleep",
  "memory.merged": "sleep",
  // The repair is the owner's, but the row it puts back is the store's.
  "memory.unmerged": "store",
  // The gate battery, wherever it runs: the chunk record is the encode door's.
  "gate.chunk": "encode",
  // Both gate doors light the SAME node. The battery is one battery; which door
  // walked a proposal up to it is a field on the row, not a second node.
  "gate.deposit": "encode",
  // The fallback's own record, including the runs that swept nothing.
  "sweep.gate": "sweep",
  // The self the fallback was woken with. It is `self/`'s composition, but what
  // the row describes is the SWEEP's prompt, so it lights the sweep node beside
  // the gate row it always arrives with.
  "sweep.wake": "sweep",
  // The cycle's own record (U9). Same call as the four above: the honest answer
  // to "who did this" is the phase that ran, and the run is the whole of sleep.
  "sleep.cycle": "sleep",
  // The wake render's record. It is `self/`'s composition and `sleep/`'s order,
  // but what the row DESCRIBES is the bundle — what rendered, what was trimmed —
  // so it lights the node the owner will actually read it against.
  "self.briefing": "wake",
  // The page is what the wake now LEADS with, so both of its rows belong to the
  // wake node: written at one boundary, read at every one after it.
  "self.page.revised": "wake",
  "self.page.refused": "wake",
  // The nightly writer belongs to the same node for the same reason: what it
  // produces is the first thing the next wake prints.
  "self.page.writer.ran": "wake",
  // The handoff is working context for a directory, written at a boundary and
  // spliced into the wake of the next session that opens there. It is not a
  // memory and never becomes one, so it lights the wake node — where the owner
  // reads it — and not `store` or `remember`.
  "handoff.written": "wake",
  "handoff.shown": "wake",
  "handoff.refused": "wake",
  "handoff.cleared": "wake",
  "handoff.lasthere.noroom": "wake",
  // The wake's "Work here" lines, and what an envelope could not carry
  // (2026-10-02): all of it is the wake's delivery.
  "self.work.overflow": "wake",
  "adapter.envelope.overcap": "wake",
  "adapter.notice.dropped": "wake",
  "adapter.envelope.gave-way": "wake",
  "adapter.injection.overbudget": "wake",
  // Reference resolution: the boundary's credit decision (recall §9.2).
  "recall.credit": "recall",
  // The wiring that follows that decision: what the reply used together got
  // linked together, by the worker the boundary spawned. `recall.credit` says
  // which memories; this says what the graph did about it.
  "associate.flush": "associate",
  // Retrieval: the decision, and the adapter's composed injection.
  "recall.decision": "recall",
  "adapter.recall": "recall",
  "adapter.semantic.lag": "recall",
  // The briefing's two halves: handed over, and confirmed as arrived.
  "adapter.wake.injected": "wake",
  "adapter.wake.delivered": "wake",
  // The host's session boundary and the parallel run's two delivery guards.
  "adapter.boundary": "session",
  "adapter.primacy.deliver": "session",
  "adapter.primacy.standdown": "session",
  // The ask that asks for memories — the authored door's pacing.
  "adapter.ask": "remember",
  "adapter.authorship.ask": "remember",
  // The episode half of the old two-ask Stop belonged to the journal.
  "adapter.episode.ask": "self",
  // The worker giving vectors to memories that had none: box 3's business.
  "adapter.embed.backfill": "store",
  // The three spawn-seam records (I32). The worker carries the crash fallback,
  // the flush and the cycle; when it cannot start or cannot finish, the node
  // that did not happen is the sweep's.
  "adapter.spawn.refused": "sweep",
  "adapter.hook.claim.lost": "session",
  "adapter.spawn.failed": "sweep",
  "adapter.runner.failed": "sweep",
  // The two failures the process log promoted to rows (2026-09-30): a turn the
  // buffer would not take, and a write-up pointer that could not be composed.
  "remember.capture.failed": "spans",
  "adapter.writeup.failed": "remember",
  // The other half of those three: the worker that DID start, same node.
  "adapter.spawn.started": "sweep",
  // The deliberate look is a retrieval, so it lands where the ambient one does.
  "mcp.recall": "recall",
  // A bundle part is the night's reading; an oversize cut is the server's
  // answer to it (2026-10-02) — both land where the dream does; so does a
  // result the host cut after the server answered (2026-10-09).
  "mcp.part": "sleep",
  "mcp.result.oversize": "sleep",
  "mcp.result.spilled": "sleep",
  // A reminder arriving is a CUE offered into the turn (§12: arrival is a cue,
  // not a command), so both rows land on the prospective node.
  "prospective.fire": "prospective",
  "prospective.fire.refused": "prospective",
  // A plain item told on its day (2026-09-26) is the same node's, by request.
  "prospective.plain": "prospective",
  // Which checkout was live at a session start. It belongs to the SESSION node:
  // it is a fact about the process the host started, recorded on the way in,
  // before anything was read or written.
  "adapter.checkout": "session",
  // The daily rotating snapshot is upkeep on the store itself — the same node
  // the backfill lands on, because what it is about is the boxes, not a memory.
  "snapshot.taken": "store",
  "snapshot.failed": "store",
  "snapshot.rotated": "store",
  // The journal's markdown copy is upkeep on the store's own directory — the
  // words are the episode row's and this is the file beside it — and the hand
  // export is the same node for the same reason: both are about the boxes.
  "journal.copy.written": "store",
  "journal.copy.failed": "store",
  "store.export": "store",
  // Retention acts on the raw capture itself — the SPANS node, where every turn
  // lands and from where the crash sweep reads. It deletes nothing a memory is.
  "remember.prune": "spans",
  // What is not written up (2026-09-30): the captured pieces' own ledger.
  "coverage.owed": "spans",
  "coverage.written": "spans",
  "coverage.lapsed": "spans",
  // The identity check is upkeep on box 3 — the vectors themselves — so it is
  // the store's, like the backfill that fills them.
  "store.embedder.reconciled": "store",
  // A credited challenge, from either arm (belief or identity element).
  "revision.pressure": "schemas",
  // DREAMING (2026-09-26) is a kind of sleep: an offline pass over what was
  // lived, so every row a dream leaves lights the sleep node. The ask is put to
  // a session, so it lights that one.
  "dream.begun": "sleep",
  "dream.changed": "sleep",
  "dream.journaled": "sleep",
  "dream.undone": "sleep",
  "dream.ask": "session",
  // The owner reaching into the core, like the merge repair: the store's.
  "band.demoted": "store",
  // The v8 upgrade's census runs in the decay phase.
  "physics.upgrade.census": "sleep",
  // Contradictions (2026-09-29): a pair argued over, like the revision arm.
  "contradiction.flagged": "schemas",
  "contradiction.settled": "schemas",
  "contradiction.undone": "schemas",
  "contradiction.held": "schemas",
} as const satisfies Record<DurableEventName, NodeKey>;

export function nodeOf(name: string): NodeKey | null {
  return (EVENT_NODE as Record<string, NodeKey>)[name] ?? null;
}

export function findNode(key: string): FlowNode | undefined {
  return FLOW_NODES.find((n) => n.key === key);
}

/** Every event name that lands on one node. Used for the node's own feed. */
export function eventsOfNode(key: NodeKey): string[] {
  return Object.entries(EVENT_NODE)
    .filter(([, node]) => node === key)
    .map(([name]) => name);
}
