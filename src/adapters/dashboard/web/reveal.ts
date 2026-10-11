/**
 * One rule, in one place: **the web views withhold a confidential memory exactly
 * the way every other surface withholds it.**
 *
 * `recall/activate.ts#isConfidential` is the predicate the surfacing gate uses;
 * a dashboard that resolved the same id straight to its first line would be the
 * one screen in the system where the rule does not hold — and it would be the
 * screen that gets screenshotted. So every id that becomes text on a web page
 * goes through `reveal()` rather than through `resolveRef` directly, and a
 * confidential row comes back as a NAMED withholding: its id, its physics, its
 * band, its place in the constellation, all still visible — only the words gone.
 *
 * That distinction is the point. Withholding the text is not hiding the memory:
 * a memory the owner cannot see the EXISTENCE of would be worse than one whose
 * sentence is on screen (constitution line 16). The label says which it is.
 *
 * Render-time, like everything else here (CONTRACT §3, scar §2.20): nothing
 * below caches, and a memory made confidential after a page loaded stops
 * resolving on the next request.
 */
import { isConfidential } from "../../../core/recall/index.js";
import type { ProseDoc, ReadOnlyStore } from "../../../core/store/index.js";
import { gistOf, looksLikeId, resolvePayload, resolveRef } from "../resolve.js";
import type { ResolvedRef } from "../resolve.js";

/** What a confidential row says instead of its first line. */
export const WITHHELD = "[confidential — withheld here as it is withheld everywhere]";

export interface Revealed {
  readonly id: string;
  readonly headId: string | null;
  readonly state: ResolvedRef["state"];
  readonly present: boolean;
  /** The current text, or null when absent OR withheld. */
  readonly text: string | null;
  /** True when the row is real and its words are deliberately not shown. */
  readonly confidential: boolean;
  /** Ready to print: the text, a named absence, or the withholding. */
  readonly label: string;
}

function confidentialAt(store: ReadOnlyStore, id: string): boolean {
  try {
    return isConfidential(store.readProse(id));
  } catch {
    // Unreadable is an absence, not a secret; `resolveRef` already named it.
    return false;
  }
}

/** Resolve one id for display. The only id-to-text path the web views use. */
export function reveal(store: ReadOnlyStore, id: string | null | undefined, width = 64): Revealed {
  const ref = resolveRef(store, id, width);
  if (!ref.present || ref.headId === null) {
    return {
      id: ref.id,
      headId: ref.headId,
      state: ref.state,
      present: false,
      text: null,
      confidential: false,
      label: ref.label,
    };
  }
  if (confidentialAt(store, ref.headId)) {
    return {
      id: ref.id,
      headId: ref.headId,
      state: ref.state,
      present: true,
      text: null,
      confidential: true,
      label: WITHHELD,
    };
  }
  return {
    id: ref.id,
    headId: ref.headId,
    state: ref.state,
    present: true,
    text: ref.text,
    confidential: false,
    label: ref.label,
  };
}

/**
 * Resolve an id at ITS OWN address, without following the forwarding chain.
 *
 * "It began as X" and "it now says Y" are unsayable without reading both ends,
 * and a superseded belief's prose is retained by design for exactly this. Still
 * render-time: an id whose own row is gone comes back as a named absence.
 */
export function revealHere(store: ReadOnlyStore, id: string | null | undefined, width = 64): Revealed {
  const ref = resolveRef(store, id, { width, follow: false });
  if (!ref.present || ref.headId === null) {
    return { id: ref.id, headId: ref.headId, state: ref.state, present: false, text: null, confidential: false, label: ref.label };
  }
  if (confidentialAt(store, ref.headId)) {
    return { id: ref.id, headId: ref.headId, state: ref.state, present: true, text: null, confidential: true, label: WITHHELD };
  }
  return { id: ref.id, headId: ref.headId, state: ref.state, present: true, text: ref.text, confidential: false, label: ref.label };
}

/** The short form a feed line or a tooltip wants: text, or the reason there is none. */
export function shortOf(store: ReadOnlyStore, id: string | null | undefined, width = 56): string {
  const r = reveal(store, id, width);
  return r.text ?? r.label;
}

/**
 * A payload, rendered — the same job as `resolvePayload`, but every id-shaped
 * value goes through `reveal` so a confidential memory named inside an event
 * detail is withheld there too. The modal is the last place a withheld sentence
 * could leak back in, which is exactly why it is worth a second pass.
 */
export function revealPayload(
  store: ReadOnlyStore,
  payload: Record<string, unknown>,
  width = 40,
): { key: string; value: string }[] {
  return resolvePayload(store, payload, width).map(({ key, value }) => {
    const raw = payload[key];
    if (!looksLikeId(raw)) return { key, value };
    const r = reveal(store, raw, width);
    return { key, value: r.confidential ? `${WITHHELD} [${raw}]` : value };
  });
}

/** A doc already in hand — the list paths read the row once and reuse it. */
export function gistOfDoc(doc: ProseDoc, width = 64): { text: string; confidential: boolean } {
  return isConfidential(doc)
    ? { text: WITHHELD, confidential: true }
    : { text: gistOf(doc, width), confidential: false };
}
