import { StoreError } from "../../core/store/index.js";
import { truncate } from "./layout.js";
export const ABSENCE = {
  unknown: "[no longer at this address]",
  removed: "[removed by you]",
  dangling: "[a forwarding address with nothing at the end]",
  broken: "[a forwarding loop]",
  unreadable: "[here, but unreadable]",
  none: "[nothing named]"
};
const TEXT_WIDTH = 64;
const FLOAT_PLACES = 3;
export function gistOf(doc, width = TEXT_WIDTH) {
  if (typeof doc.title === "string" && doc.title.trim().length > 0) {
    return truncate(doc.title, width);
  }
  const firstProse = doc.body.split(`
`).map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("#"));
  return truncate(firstProse ?? doc.body, width);
}
function errCode(err) {
  return err instanceof StoreError ? err.code : "UNREADABLE";
}
function requireHere(store, id) {
  if (store.row(id) === undefined)
    throw new StoreError("ID_UNKNOWN", { id });
  return id;
}
export function resolveRef(store, id, widthOrOpts = TEXT_WIDTH) {
  const opts = typeof widthOrOpts === "number" ? { width: widthOrOpts } : widthOrOpts;
  const width = opts.width ?? TEXT_WIDTH;
  const follow = opts.follow !== false;
  if (typeof id !== "string" || id.trim().length === 0) {
    return { id: "", headId: null, state: "none", present: false, text: null, label: ABSENCE.none };
  }
  let headId;
  try {
    headId = follow ? store.resolve(id) : requireHere(store, id);
  } catch (err) {
    const code = errCode(err);
    const state = code === "ID_UNKNOWN" ? "unknown" : code === "ID_DANGLING" ? "dangling" : code === "ID_CYCLE" || code === "ID_CHAIN_TOO_DEEP" ? "broken" : "unreadable";
    return {
      id,
      headId: null,
      state,
      present: false,
      text: null,
      label: `${ABSENCE[state]} ${id}`
    };
  }
  let doc;
  try {
    doc = store.readProse(headId);
  } catch (err) {
    const state = errCode(err) === "REMOVED" ? "removed" : "unreadable";
    return {
      id,
      headId,
      state,
      present: false,
      text: null,
      label: `${ABSENCE[state]} ${id}`
    };
  }
  const row = store.row(headId);
  const text = gistOf(doc, width);
  const forwarded = headId !== id;
  const state = forwarded ? "superseded" : row?.archived === 1 ? "archived" : "live";
  const label = forwarded ? `"${text}" [${headId}, was ${id}]` : state === "archived" ? `"${text}" [${id}, archived: ${row?.archived_reason ?? "no reason recorded"}]` : `"${text}" [${id}]`;
  return { id, headId, state, present: true, text, label };
}
const ID_SHAPE = /^(?:mem|epi|sch)_[0-9a-z]+$/;
export function looksLikeId(value) {
  return typeof value === "string" && ID_SHAPE.test(value);
}
export function resolvePayload(store, payload, width = 40) {
  return Object.entries(payload).map(([key, value]) => {
    if (looksLikeId(value))
      return { key, value: resolveRef(store, value, width).label };
    if (value === null)
      return { key, value: "null" };
    if (typeof value === "number") {
      return { key, value: Number.isInteger(value) ? String(value) : value.toFixed(FLOAT_PLACES) };
    }
    if (typeof value === "object")
      return { key, value: JSON.stringify(value) };
    return { key, value: String(value) };
  });
}
