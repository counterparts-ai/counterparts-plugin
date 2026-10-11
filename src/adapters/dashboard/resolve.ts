/**
 * Render-time id resolution — the keep this adapter would be dishonest without
 * (CONTRACT §3, scar §2.20; v1's dashboard batch).
 *
 * The rule: **nothing printed here is text that was stored alongside an id.**
 * Every id the dashboard shows goes through `resolveRef` at the moment of
 * rendering, and what comes back is either the CURRENT text at that address or a
 * NAMED absence. So an owner-removed memory stops appearing the instant it is
 * removed, a superseded belief prints what it became rather than what it said,
 * and a dangling pointer says it is dangling instead of quietly showing the last
 * thing anyone happened to cache.
 *
 * Every path is read-only and every failure is a value, never a throw: this runs
 * in an instrument, and an instrument that crashes on a broken store is the one
 * moment the owner most needs it to render (`observer-mode.md`, scar E7).
 */
import { StoreError } from "../../core/store/index.js";
import type { ProseDoc, ReadOnlyStore } from "../../core/store/index.js";
import { truncate } from "./layout.js";

export type RefState =
  /** Resolves, is the live head, is not archived. */
  | "live"
  /** Resolves, but the address forwards: what it BECAME is what we print. */
  | "superseded"
  /** Resolves and is the head, but archived (pruned, merged, faded). */
  | "archived"
  /** No such row. The commonest honest absence. */
  | "unknown"
  /** The owner removed it. The deny list answers before the prose does. */
  | "removed"
  /** A forwarding address whose destination is gone. */
  | "dangling"
  /** A forwarding loop, or one too deep to walk. */
  | "broken"
  /** The row is there and the prose is not readable. */
  | "unreadable"
  /** No id was given at all. */
  | "none";

/**
 * The named absences, in the system's own voice. They are WORDS, not blanks:
 * a blank is indistinguishable from "nothing was ever here", which is exactly
 * the distinction scar §2.4 refuses to lose.
 */
export const ABSENCE: Record<Exclude<RefState, "live" | "superseded" | "archived">, string> = {
  unknown: "[no longer at this address]",
  removed: "[removed by the owner]",
  dangling: "[a forwarding address with nothing at the end]",
  broken: "[a forwarding loop]",
  unreadable: "[here, but unreadable]",
  none: "[nothing named]",
};

export interface ResolvedRef {
  /** The id as it was stored — always shown, so the owner can go look. */
  readonly id: string;
  /** The live head this address forwards to, when there is one. */
  readonly headId: string | null;
  readonly state: RefState;
  /** Whether anything is actually there right now. */
  readonly present: boolean;
  /** The CURRENT text at this address, resolved just now. Null when absent. */
  readonly text: string | null;
  /** The whole thing, ready to print. Never persisted anywhere. */
  readonly label: string;
}

const TEXT_WIDTH = 64;
/** Decimal places a telemetry float is printed to. Display only. */
const FLOAT_PLACES = 3;

/** Title if it has one, else its opening line. Never the whole body. */
export function gistOf(doc: ProseDoc, width = TEXT_WIDTH): string {
  if (typeof doc.title === "string" && doc.title.trim().length > 0) {
    return truncate(doc.title, width);
  }
  const firstProse = doc.body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#"));
  return truncate(firstProse ?? doc.body, width);
}

function errCode(err: unknown): string {
  return err instanceof StoreError ? err.code : "UNREADABLE";
}

/** `resolve()` without the forwarding walk: is there a row at THIS address? */
function requireHere(store: ReadOnlyStore, id: string): string {
  if (store.row(id) === undefined) throw new StoreError("ID_UNKNOWN", { id });
  return id;
}

export interface ResolveOptions {
  readonly width?: number;
  /**
   * Follow the forwarding address (the default). `false` resolves the id's OWN
   * current content instead — which is still a render-time read of live state,
   * not baked text: a superseded belief's prose is RETAINED by design (§5 G10,
   * earned live when accommodation's forensics needed the retained element), and
   * "it began as X, it now says Y" is unsayable without reading both ends. An id
   * whose own row is gone still comes back as a named absence.
   */
  readonly follow?: boolean;
}

/**
 * Resolve one id, now. `width` bounds the text, not the truth: a truncated gist
 * ends in an ellipsis so nobody mistakes it for the whole memory.
 */
export function resolveRef(
  store: ReadOnlyStore,
  id: string | null | undefined,
  widthOrOpts: number | ResolveOptions = TEXT_WIDTH,
): ResolvedRef {
  const opts: ResolveOptions =
    typeof widthOrOpts === "number" ? { width: widthOrOpts } : widthOrOpts;
  const width = opts.width ?? TEXT_WIDTH;
  const follow = opts.follow !== false;

  if (typeof id !== "string" || id.trim().length === 0) {
    return { id: "", headId: null, state: "none", present: false, text: null, label: ABSENCE.none };
  }

  let headId: string;
  try {
    headId = follow ? store.resolve(id) : requireHere(store, id);
  } catch (err) {
    const code = errCode(err);
    const state: RefState =
      code === "ID_UNKNOWN"
        ? "unknown"
        : code === "ID_DANGLING"
          ? "dangling"
          : code === "ID_CYCLE" || code === "ID_CHAIN_TOO_DEEP"
            ? "broken"
            : "unreadable";
    return {
      id,
      headId: null,
      state,
      present: false,
      text: null,
      label: `${ABSENCE[state as keyof typeof ABSENCE]} ${id}`,
    };
  }

  let doc: ProseDoc;
  try {
    doc = store.readProse(headId);
  } catch (err) {
    // REMOVED is the owner's erasure answering before the prose does — the one
    // absence that must never degrade into "unreadable".
    const state: RefState = errCode(err) === "REMOVED" ? "removed" : "unreadable";
    return {
      id,
      headId,
      state,
      present: false,
      text: null,
      label: `${ABSENCE[state as keyof typeof ABSENCE]} ${id}`,
    };
  }

  const row = store.row(headId);
  const text = gistOf(doc, width);
  const forwarded = headId !== id;
  const state: RefState = forwarded ? "superseded" : row?.archived === 1 ? "archived" : "live";
  const label = forwarded
    ? `"${text}" [${headId}, was ${id}]`
    : state === "archived"
      ? `"${text}" [${id}, archived: ${row?.archived_reason ?? "no reason recorded"}]`
      : `"${text}" [${id}]`;
  return { id, headId, state, present: true, text, label };
}

/** True for a string that looks like one of this store's addresses. */
const ID_SHAPE = /^(?:mem|epi|sch)_[0-9a-z]+$/;

export function looksLikeId(value: unknown): value is string {
  return typeof value === "string" && ID_SHAPE.test(value);
}

/**
 * Render one telemetry payload. Ids inside it are resolved the same way ids
 * outside it are — that is what "content-by-reference, resolved at render" has
 * to mean for the activity feed, or the feed becomes a wall of hex.
 */
export function resolvePayload(
  store: ReadOnlyStore,
  payload: Record<string, unknown>,
  width = 40,
): { key: string; value: string }[] {
  return Object.entries(payload).map(([key, value]) => {
    if (looksLikeId(value)) return { key, value: resolveRef(store, value, width).label };
    if (value === null) return { key, value: "null" };
    // A raw float is telemetry, not a reading: `0.5975142297464837` costs the eye
    // more than it tells it. Integers stay whole.
    if (typeof value === "number") {
      return { key, value: Number.isInteger(value) ? String(value) : value.toFixed(FLOAT_PLACES) };
    }
    if (typeof value === "object") return { key, value: JSON.stringify(value) };
    return { key, value: String(value) };
  });
}
