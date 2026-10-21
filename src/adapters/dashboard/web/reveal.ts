/**
 * One rule, in one place: **every id that becomes text on a web page goes
 * through `reveal()`** rather than through `resolveRef` directly, so the web
 * views name an absence (removed, superseded, unreadable) the same way
 * everywhere.
 *
 * (Until 2026-10-21 this was also where a confidential memory's words were
 * withheld; that mark is retired.)
 *
 * Render-time, like everything else here (CONTRACT §3, scar §2.20): nothing
 * below caches.
 */
import type { ProseDoc, ReadOnlyStore } from "../../../core/store/index.js";
import { gistOf, resolvePayload, resolveRef } from "../resolve.js";
import type { ResolvedRef } from "../resolve.js";

export interface Revealed {
  readonly id: string;
  readonly headId: string | null;
  readonly state: ResolvedRef["state"];
  readonly present: boolean;
  /** The current text, or null when absent. */
  readonly text: string | null;
  /** Ready to print: the text, or a named absence. */
  readonly label: string;
}

function revealed(ref: ResolvedRef): Revealed {
  const present = ref.present && ref.headId !== null;
  return {
    id: ref.id,
    headId: ref.headId,
    state: ref.state,
    present,
    text: present ? ref.text : null,
    label: ref.label,
  };
}

/** Resolve one id for display. The only id-to-text path the web views use. */
export function reveal(store: ReadOnlyStore, id: string | null | undefined, width = 64): Revealed {
  return revealed(resolveRef(store, id, width));
}

/**
 * Resolve an id at ITS OWN address, without following the forwarding chain.
 *
 * "It began as X" and "it now says Y" are unsayable without reading both ends,
 * and a superseded belief's prose is retained by design for exactly this. Still
 * render-time: an id whose own row is gone comes back as a named absence.
 */
export function revealHere(store: ReadOnlyStore, id: string | null | undefined, width = 64): Revealed {
  return revealed(resolveRef(store, id, { width, follow: false }));
}

/** The short form a feed line or a tooltip wants: text, or the reason there is none. */
export function shortOf(store: ReadOnlyStore, id: string | null | undefined, width = 56): string {
  const r = reveal(store, id, width);
  return r.text ?? r.label;
}

/** A payload, rendered: `resolvePayload`, kept here so the views have one door. */
export function revealPayload(
  store: ReadOnlyStore,
  payload: Record<string, unknown>,
  width = 40,
): { key: string; value: string }[] {
  return resolvePayload(store, payload, width);
}

/** A doc already in hand — the list paths read the row once and reuse it. */
export function gistOfDoc(doc: ProseDoc, width = 64): { text: string } {
  return { text: gistOf(doc, width) };
}
