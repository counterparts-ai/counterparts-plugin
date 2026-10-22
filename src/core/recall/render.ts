/**
 * The bounded injection.
 *
 * Scar §2.3, in one sentence: *a budget on a sub-lane is not a budget, and "we
 * rendered it" is not "they received it."* v1 byte-capped its index lane at 8,192
 * and left the composed bundle unbounded; every session for eleven days received
 * about 3 of 16 elements, and nothing said so. So:
 *
 *   - the budget governs the **composed total**, sentinel included;
 *   - the **trim order is explicit** (`TRIM_ORDER`) and tested, not emergent;
 *   - every render ends with a **self-describing tail sentinel** (counts + bytes)
 *     so the consumer can verify arrival from the last line alone;
 *   - there is a **delivery-side** event, not only a render-side one
 *     (`Recall.noteDelivered`).
 *
 * **Ids resolve to text HERE**, at render time, through the `Resolve` seam — never
 * baked into the decision record or the telemetry. An erased memory stops
 * resolving the instant it leaves the store, where baked-in text would outlive
 * erasure for a whole retention window.
 *
 * **A quiet turn renders the empty string**, not an empty block and not a bare
 * sentinel (§9 OUTPUTS).
 */

/**
 * THE OQ4 PROBE, STEP 0 → STEP 1. The "quietly available / ignorable" header
 * was v1's deliberate, never-measured probe of whether footnotes are actually
 * ignorable to a model (contract §7 OQ4). On 2026-09-14 the model, asked "what
 * do you remember?", asserted counts and characterizations of five footnoted
 * memories from their 80-byte titles without expanding one (IMPROVEMENTS U5):
 * "ignorable" read as "not obligated", which is right for the ambient design
 * and says nothing about what to do before RELYING on one. Step 1 keeps the
 * word and adds the one instruction the failure lacked. The step-0 string is
 * kept beside it so the owner can reverse the step with a one-line ruling; the
 * measurement is `probe.ts` (`counterparts probe-oq4`), from rows the store
 * already keeps, so the before/after reads off the same table.
 */
export const FOOTNOTE_HEADER_STEP_0 = "Quietly available (ignorable):";
export const FOOTNOTE_HEADER_STEP_1 =
  "Quietly available (ignorable; expand an id with recall before citing one):";

/**
 * Framing is load-bearing and part of the spec (§9 G17). The footnote header
 * is the OQ4 probe's one string (above); everything else here is v1's.
 */
export const FRAMING = {
  /** Content-free by construction: no ids, no bodies, no feeling named. */
  affect: "Something here carries weight.",
  surfacedHeader: "Came to mind:",
  footnoteHeader: FOOTNOTE_HEADER_STEP_1,
  /**
   * ONE WORD, IN FRONT OF A CHAPTER (owner ruling, 2026-09-04 — LAUNCH-STATUS
   * §I14). A journal entry is the first-person ACCOUNT a memory was made from,
   * not a memory: it sits outside every sleep phase (`sleep/types.ts#isJournal`)
   * and the dashboard has said so in prose since #33, while recall delivered
   * `epi_` rows unmarked in both tiers. The ruling keeps them recallable — a
   * chapter about the lighthouse conversation may rightly come to mind — and
   * makes them say what they are.
   *
   * It is a LABEL, never a filter: nothing about what is recallable, ranked or
   * gated moves. And it goes in front of the text rather than after it, for the
   * same reason the wake's date does (`self/briefing.ts#datePrefix`): what
   * qualifies a claim has to be read before the claim, not after it has landed.
   */
  journal: "Journal:",
  /**
   * ONE WORD, IN FRONT OF A QUIET POINTER (association build 2, 2026-09-28 —
   * working default). A pointer came to mind by association — a link from
   * something the turn did reach — not by the turn's own words or meaning, and
   * the reader should know that before it reads the title. Same shape and same
   * reason as `journal`: a label, never a filter.
   */
  linked: "Linked:",
  /**
   * THE BELIEFS SLOT'S HEADER (wave 2 lane E, 2026-10-22; design §7): what
   * the subjects this turn named are held to be, in a slot of their own, so
   * a belief never reads as a footnote and a reader knows it may rate one.
   */
  beliefsHeader: "Held about what came up (beliefs; rate like footnotes):",
} as const;

export type Lane = "belief" | "footnote" | "surfaced" | "affect";

/**
 * The explicit trim order: cheapest-to-lose first. The beliefs slot is an
 * experiment measured against the footnotes (wave 2 lane E), so it gives way
 * first, weakest belief first, and never takes a footnote's room. Footnotes are
 * pointers and go weakest-first; surfaced gists are rare and expensive to have
 * earned; the affect flag is one content-free line and is the last thing standing.
 */
export const TRIM_ORDER: readonly Lane[] = ["belief", "footnote", "surfaced", "affect"];

/** One belief line of the slot, composed by the caller (`beliefLine`), strongest first. */
export interface BeliefLine {
  readonly id: string;
  readonly text: string;
}

/**
 * A belief's strength in one word (lane E, 2026-10-22): what the slot and the
 * wake's project line say beside a statement. Contested says so first. The
 * cuts are physics' strength on the support arm's scale (`BELIEF_SUPPORT_CAP`
 * 0.9): about two well-spread supports pass 0.45, about four 0.65. CAL.
 */
export function strengthWord(strength: number, contested = false): string {
  if (contested) return "contested";
  if (strength > 0.65) return "firm";
  if (strength > 0.45) return "fairly sure";
  return "tentative";
}

/**
 * One belief line's text, without the dash: `Subject: statement (word; N
 * memories) [id]`. The statement alone is clipped; the subject, the word, the
 * count and the id ride outside the clip, as a footnote's label does.
 */
export function beliefLine(b: { id: string; subject: string; statement: string; strength: number; support: number; contested?: boolean }, maxBytes: number): string {
  const who = b.subject.trim().length === 0 ? "" : `${b.subject.trim()}: `;
  const count = `${String(b.support)} ${b.support === 1 ? "memory" : "memories"}`;
  return `${who}${clip(b.statement, maxBytes)} (${strengthWord(b.strength, b.contested === true)}; ${count}) [${b.id}]`;
}

export interface Resolved {
  readonly title: string;
  readonly gist: string;
  /** True when the row is a journal entry (`ProseDoc.type === "episode"`), which
   *  renders with `FRAMING.journal` in front of it. Absent reads as false, so a
   *  resolver that predates the label marks nothing. */
  readonly journal?: boolean;
  /** True for a quiet pointer (`Candidate.linkOnly`), which renders with
   *  `FRAMING.linked` in front of it. Absent reads as false. */
  readonly linked?: boolean;
  /**
   * The memory's STANDING in a contradiction (2026-09-29, `standing.ts`): a
   * qualifier in front (`Earlier (now [id]): `, `Unsettled — may be out of
   * date, see [id]: `) and a pointer after (` (disagrees with [id])`).
   * Outside the clip, like the journal word. Absent: nothing to say.
   */
  readonly standing?: { readonly prefix: string; readonly suffix: string };
}

/** Id -> text, at render time. */
export type Resolve = (id: string) => Resolved;

export interface RenderInput {
  readonly turn: number;
  readonly affectFlag: boolean;
  /** Ids, strongest first. */
  readonly surfaced: readonly string[];
  readonly footnotes: readonly string[];
  /** The beliefs slot's lines, strongest first (lane E). Absent or empty: no slot, and the render is what it was. */
  readonly beliefs?: readonly BeliefLine[];
  readonly budgetBytes: number;
  readonly gistBytes: number;
  readonly titleBytes: number;
  readonly pressureRatio: number;
}

export interface TrimEvent {
  readonly lane: Lane;
  readonly id: string | null;
}

export interface RenderResult {
  readonly text: string;
  readonly bytes: number;
  readonly budgetBytes: number;
  readonly surfaced: string[];
  readonly footnotes: string[];
  /** The belief ids the render carried, in order (lane E); empty when none. */
  readonly beliefs: string[];
  /** What the beliefs slot cost: its header, lines and blank line, in bytes; 0 when none. */
  readonly beliefBytes: number;
  readonly affectFlag: boolean;
  readonly trimmed: TrimEvent[];
  /** The tail line, or null on a quiet turn. */
  readonly sentinel: string | null;
  /** True when the composed render crossed the pressure ratio — the tripwire
   *  that fires when a budget is APPROACHED, not only when it blows (scar §2.4). */
  readonly pressure: boolean;
}

const encoder = new TextEncoder();

export function byteLength(s: string): number {
  return encoder.encode(s).length;
}

/** Truncate to a byte budget on a character boundary, marking the elision. */
export function clip(text: string, maxBytes: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (byteLength(flat) <= maxBytes) return flat;
  const ell = "...";
  const room = Math.max(0, maxBytes - byteLength(ell));
  let out = "";
  for (const ch of flat) {
    if (byteLength(out + ch) > room) break;
    out += ch;
  }
  return `${out.trimEnd()}${ell}`;
}

/**
 * The one-word prefix, OUTSIDE the clip. The label is what tells a reader the
 * line is not a memory, so it can never be the part that the byte budget eats:
 * clipping runs on the content and the label is added afterwards. A line that
 * did not fit is dropped whole by the trim order, which is where that decision
 * belongs.
 */
function label(r: Resolved): string {
  return `${r.linked === true ? `${FRAMING.linked} ` : ""}${r.journal === true ? `${FRAMING.journal} ` : ""}${r.standing?.prefix ?? ""}`;
}

/** The standing's pointer, after the text and outside the clip, like the label. */
function after(r: Resolved): string {
  return r.standing?.suffix ?? "";
}

function openMarker(turn: number): string {
  return `<!-- counterparts:recall t=${turn} -->`;
}

function sentinelLine(
  surfaced: number,
  footnotes: number,
  affect: boolean,
  bytes: number,
  beliefs = 0,
): string {
  // `beliefs=` only when the slot carried one (lane E): a turn without it ends
  // on exactly the line it always did.
  return `<!-- counterparts:recall/end surfaced=${surfaced} footnotes=${footnotes} affect=${affect ? 1 : 0}${beliefs > 0 ? ` beliefs=${beliefs}` : ""} bytes=${bytes} -->`;
}

interface Composition {
  text: string;
  bytes: number;
  sentinel: string;
  beliefBytes: number;
}

function compose(
  input: RenderInput,
  resolve: Resolve,
  surfaced: readonly string[],
  footnotes: readonly string[],
  affect: boolean,
  beliefs: readonly BeliefLine[] = [],
): Composition {
  const lines: string[] = [openMarker(input.turn)];
  if (affect) lines.push(FRAMING.affect);
  if (surfaced.length > 0) {
    lines.push("", FRAMING.surfacedHeader);
    for (const id of surfaced) {
      const r = resolve(id);
      lines.push(`- ${label(r)}${clip(r.gist, input.gistBytes)}${after(r)}`);
    }
  }
  if (footnotes.length > 0) {
    lines.push("", FRAMING.footnoteHeader);
    // Pointers with short titles, NEVER bodies (§9 OUTPUTS).
    for (const id of footnotes) {
      const r = resolve(id);
      lines.push(`- ${label(r)}${clip(r.title, input.titleBytes)} [${id}]${after(r)}`);
    }
  }
  // THE BELIEFS SLOT (lane E), after the footnotes, in its own labelled block.
  let beliefBytes = 0;
  if (beliefs.length > 0) {
    const block = ["", FRAMING.beliefsHeader, ...beliefs.map((b) => `- ${b.text}`)];
    beliefBytes = byteLength(`\n${block.join("\n")}`);
    lines.push(...block);
  }
  const body = lines.join("\n");
  // Fixed point: the sentinel states the total byte count, and stating it changes
  // it. Two or three passes settle once the digit count stops moving.
  let total = byteLength(body) + 1;
  let sentinel = sentinelLine(surfaced.length, footnotes.length, affect, total, beliefs.length);
  for (let i = 0; i < 5; i++) {
    const next = byteLength(body) + 1 + byteLength(sentinel);
    if (next === total) break;
    total = next;
    sentinel = sentinelLine(surfaced.length, footnotes.length, affect, total, beliefs.length);
  }
  const text = `${body}\n${sentinel}`;
  return { text, bytes: byteLength(text), sentinel, beliefBytes };
}

/**
 * Compose within the budget, trimming in `TRIM_ORDER` until it fits. If even the
 * smallest render does not fit, the turn goes quiet — an over-budget injection is
 * never emitted, and a truncated one is not a smaller injection but a corrupted
 * one.
 */
export function render(input: RenderInput, resolve: Resolve): RenderResult {
  const surfaced = [...input.surfaced];
  const footnotes = [...input.footnotes];
  const beliefs = [...(input.beliefs ?? [])];
  let affect = input.affectFlag;
  const trimmed: TrimEvent[] = [];

  if (surfaced.length === 0 && footnotes.length === 0 && beliefs.length === 0 && !affect) {
    return {
      text: "",
      bytes: 0,
      budgetBytes: input.budgetBytes,
      surfaced: [],
      footnotes: [],
      beliefs: [],
      beliefBytes: 0,
      affectFlag: false,
      trimmed,
      sentinel: null,
      pressure: false,
    };
  }

  for (;;) {
    const c = compose(input, resolve, surfaced, footnotes, affect, beliefs);
    if (c.bytes <= input.budgetBytes) {
      return {
        text: c.text,
        bytes: c.bytes,
        budgetBytes: input.budgetBytes,
        surfaced,
        footnotes,
        beliefs: beliefs.map((b) => b.id),
        beliefBytes: c.beliefBytes,
        affectFlag: affect,
        trimmed,
        sentinel: c.sentinel,
        pressure: c.bytes >= input.budgetBytes * input.pressureRatio,
      };
    }
    let cut = false;
    for (const lane of TRIM_ORDER) {
      if (lane === "belief" && beliefs.length > 0) {
        trimmed.push({ lane, id: beliefs.pop()?.id ?? null });
        cut = true;
        break;
      }
      if (lane === "footnote" && footnotes.length > 0) {
        trimmed.push({ lane, id: footnotes.pop() ?? null });
        cut = true;
        break;
      }
      if (lane === "surfaced" && surfaced.length > 0) {
        trimmed.push({ lane, id: surfaced.pop() ?? null });
        cut = true;
        break;
      }
      if (lane === "affect" && affect) {
        trimmed.push({ lane, id: null });
        affect = false;
        cut = true;
        break;
      }
    }
    if (!cut) {
      // Nothing left to give: go quiet rather than emit an over-budget render.
      return {
        text: "",
        bytes: 0,
        budgetBytes: input.budgetBytes,
        surfaced: [],
        footnotes: [],
        beliefs: [],
        beliefBytes: 0,
        affectFlag: false,
        trimmed,
        sentinel: null,
        pressure: true,
      };
    }
  }
}
