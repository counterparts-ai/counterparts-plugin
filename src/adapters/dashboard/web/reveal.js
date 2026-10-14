import { isConfidential } from "../../../core/recall/index.js";
import { gistOf, looksLikeId, resolvePayload, resolveRef } from "../resolve.js";
export const WITHHELD = "[confidential — withheld here as it is withheld everywhere]";
function confidentialAt(store, id) {
  try {
    return isConfidential(store.readProse(id));
  } catch {
    return false;
  }
}
export function reveal(store, id, width = 64) {
  const ref = resolveRef(store, id, width);
  if (!ref.present || ref.headId === null) {
    return {
      id: ref.id,
      headId: ref.headId,
      state: ref.state,
      present: false,
      text: null,
      confidential: false,
      label: ref.label
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
      label: WITHHELD
    };
  }
  return {
    id: ref.id,
    headId: ref.headId,
    state: ref.state,
    present: true,
    text: ref.text,
    confidential: false,
    label: ref.label
  };
}
export function revealHere(store, id, width = 64) {
  const ref = resolveRef(store, id, { width, follow: false });
  if (!ref.present || ref.headId === null) {
    return { id: ref.id, headId: ref.headId, state: ref.state, present: false, text: null, confidential: false, label: ref.label };
  }
  if (confidentialAt(store, ref.headId)) {
    return { id: ref.id, headId: ref.headId, state: ref.state, present: true, text: null, confidential: true, label: WITHHELD };
  }
  return { id: ref.id, headId: ref.headId, state: ref.state, present: true, text: ref.text, confidential: false, label: ref.label };
}
export function shortOf(store, id, width = 56) {
  const r = reveal(store, id, width);
  return r.text ?? r.label;
}
export function revealPayload(store, payload, width = 40) {
  return resolvePayload(store, payload, width).map(({ key, value }) => {
    const raw = payload[key];
    if (!looksLikeId(raw))
      return { key, value };
    const r = reveal(store, raw, width);
    return { key, value: r.confidential ? `${WITHHELD} [${raw}]` : value };
  });
}
export function gistOfDoc(doc, width = 64) {
  return isConfidential(doc) ? { text: WITHHELD, confidential: true } : { text: gistOf(doc, width), confidential: false };
}
