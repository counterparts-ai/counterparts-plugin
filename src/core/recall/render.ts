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
} as const;

export type Lane = "footnote" | "surfaced" | "affect";

/**
 * The explicit trim order: cheapest-to-lose first. Footnotes are pointers and go
 * weakest-first; surfaced gists are rare and expensive to have earned; the affect
 * flag is one content-free line and is the last thing standing.
 */
export const TRIM_ORDER: readonly Lane[] = ["footnote", "surfaced", "affect"];

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
): string {
  return `<!-- counterparts:recall/end surfaced=${surfaced} footnotes=${footnotes} affect=${affect ? 1 : 0} bytes=${bytes} -->`;
}

interface Composition {
  text: string;
  bytes: number;
  sentinel: string;
}

function compose(
  input: RenderInput,
  resolve: Resolve,
  surfaced: readonly string[],
  footnotes: readonly string[],
  affect: boolean,
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
  const body = lines.join("\n");
  // Fixed point: the sentinel states the total byte count, and stating it changes
  // it. Two or three passes settle once the digit count stops moving.
  let total = byteLength(body) + 1;
  let sentinel = sentinelLine(surfaced.length, footnotes.length, affect, total);
  for (let i = 0; i < 5; i++) {
    const next = byteLength(body) + 1 + byteLength(sentinel);
    if (next === total) break;
    total = next;
    sentinel = sentinelLine(surfaced.length, footnotes.length, affect, total);
  }
  const text = `${body}\n${sentinel}`;
  return { text, bytes: byteLength(text), sentinel };
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
  let affect = input.affectFlag;
  const trimmed: TrimEvent[] = [];

  if (surfaced.length === 0 && footnotes.length === 0 && !affect) {
    return {
      text: "",
      bytes: 0,
      budgetBytes: input.budgetBytes,
      surfaced: [],
      footnotes: [],
      affectFlag: false,
      trimmed,
      sentinel: null,
      pressure: false,
    };
  }

  for (;;) {
    const c = compose(input, resolve, surfaced, footnotes, affect);
    if (c.bytes <= input.budgetBytes) {
      return {
        text: c.text,
        bytes: c.bytes,
        budgetBytes: input.budgetBytes,
        surfaced,
        footnotes,
        affectFlag: affect,
        trimmed,
        sentinel: c.sentinel,
        pressure: c.bytes >= input.budgetBytes * input.pressureRatio,
      };
    }
    let cut = false;
    for (const lane of TRIM_ORDER) {
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
        affectFlag: false,
        trimmed,
        sentinel: null,
        pressure: true,
      };
    }
  }
}
