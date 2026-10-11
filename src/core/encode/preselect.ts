/**
 * Encode-time preselection — what the author may see (behavioral-spec §8).
 *
 * Brain analog: schema activation at encoding. Without it there is no prediction
 * error, and therefore no revision.
 *
 * TWO CHANNELS, UNIONED — never one replacing the other (§8 G1):
 *   - a precise LEXICAL channel (name or alias in the span, AS A WHOLE WORD, by
 *     the one definition schema birth also uses) that never gives ground;
 *   - a SEMANTIC channel (nearest schemas above a floor, capped) that only ever
 *     *adds*.
 *
 * The semantic channel is degradable by construction (§5 G8, scar E1): no
 * vectors, or a vector that does not line up, yields an empty semantic set and a
 * LOUD SKIP — never a thrown chunk. Worst case is exactly lexical-only.
 * **Deliberately off (cap 0) is silence; a failure is a skip**, and the two are
 * different records.
 *
 * Preselection happens ONCE PER CHUNK (§5 G7): `preselectSchemas` returns the one
 * object, and `renderSchemaContext` takes that object rather than the raw inputs,
 * so the prompt builder and the blind-rate counter cannot disagree about what the
 * author saw.
 */

import { cosine } from "../physics/index.js";
import { redactSecrets } from "./secrets.js";
import { TUNABLES } from "./tunables.js";
import { occursAsWholeWord } from "./words.js";
import type { ChannelRecord, ChannelState, EncodeEvent } from "./types.js";

export type Channel = "lexical" | "semantic";

/** One element on a slice: a verbatim statement, optionally with its ADDRESS —
 *  the id an `updates:` declaration names, which is what lets a shown
 *  contradiction become a DECLARED revision instead of a loose restatement.
 *  Bare strings stay accepted for address-less context (an id renders only
 *  when real — never invented). */
export type SliceStatement = string | { readonly id: string; readonly statement: string };

export interface SchemaSlice {
  id: string;
  name: string;
  aliases?: readonly string[];
  /** Supplied by the caller. Encode never fetches or computes one. */
  vector?: readonly number[] | null;
  /** Rendered VERBATIM (§8 G7): the surface contradiction detection runs on. */
  beliefs?: readonly SliceStatement[];
  /** Rendered VERBATIM, same reason. */
  currentState?: readonly SliceStatement[];
  /** Rendered COMPRESSED, under a byte budget, with the elision announced. */
  identityCore?: string;
}

export function sliceStatementOf(s: SliceStatement): string {
  return typeof s === "string" ? s : s.statement;
}

export function sliceAddressOf(s: SliceStatement): string | null {
  return typeof s === "string" ? null : s.id;
}

export interface SelectedSchema {
  id: string;
  /** Every channel that selected it — the OVERLAP is reported, not hidden (§8 G4). */
  channels: Channel[];
  /** cos(chunk, schema) when the semantic channel ranked it; null otherwise. */
  score: number | null;
}

export interface Preselection {
  chunkRef: string;
  shown: SelectedSchema[];
  lexicalIds: string[];
  semanticIds: string[];
  /** Ids BOTH channels reached — the answer to "did the new channel add anything?" */
  overlapIds: string[];
  /** Ids ONLY the semantic channel reached. Framed honestly at render (§8 G6). */
  semanticOnlyIds: string[];
  /** Counted, not assumed (§5 G9, scar §2.9). */
  blind: boolean;
  semantic: ChannelRecord;
  candidates: number;
  floor: number;
  cap: number;
  events: EncodeEvent[];
}

export interface PreselectInput {
  chunkRef: string;
  span: string;
  schemas: readonly SchemaSlice[];
  /** The chunk's vector, supplied by the caller. Absent ⇒ the channel SKIPS. */
  chunkVector?: readonly number[] | null;
  /** 0 means deliberately off (silence). Absent uses the TUNABLE. */
  semanticCap?: number;
  semanticFloor?: number;
}

function channelRecord(state: ChannelState, reason: string): ChannelRecord {
  return { channel: "semantic-preselection", state, reason };
}

export function preselectSchemas(input: PreselectInput): Preselection {
  const cap = input.semanticCap ?? TUNABLES.SEMANTIC_CAP;
  const floor = input.semanticFloor ?? TUNABLES.SEMANTIC_FLOOR;
  const schemas = input.schemas;

  // ── the lexical channel: never gives ground ───────────────────────────────
  const lexicalIds: string[] = [];
  for (const s of schemas) {
    const terms = [s.name, ...(s.aliases ?? [])];
    if (terms.some((t) => occursAsWholeWord(input.span, t))) lexicalIds.push(s.id);
  }

  // ── the semantic channel: only ever adds, and degrades to empty ───────────
  const scores = new Map<string, number>();
  const semanticSelected = new Set<string>();
  let semantic: ChannelRecord;
  if (cap <= 0) {
    semantic = channelRecord("off", "cap-zero-deliberately-off");
  } else if (
    input.chunkVector === null ||
    input.chunkVector === undefined ||
    input.chunkVector.length === 0
  ) {
    semantic = channelRecord("skipped", "no-chunk-vector");
  } else {
    const v = input.chunkVector;
    // Ranks over EVERY schema, alias hits included (§8 G4), so the overlap is a
    // measurement rather than an argument.
    const ranked: { id: string; score: number }[] = [];
    let mismatched = 0;
    for (const s of schemas) {
      const sv = s.vector;
      if (sv === null || sv === undefined || sv.length === 0) continue;
      if (sv.length !== v.length) {
        mismatched += 1;
        continue;
      }
      ranked.push({ id: s.id, score: cosine(v, sv) });
    }
    if (ranked.length === 0) {
      semantic = channelRecord(
        "skipped",
        mismatched > 0 ? "vector-dimension-mismatch" : "no-schema-vectors",
      );
    } else {
      ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      for (const r of ranked) scores.set(r.id, r.score);
      // The floor first, THEN the cap: a cap is a guard against re-inflating what
      // a fix deflated, not a way to smuggle sub-floor schemas in.
      for (const r of ranked.filter((x) => x.score >= floor).slice(0, cap)) {
        semanticSelected.add(r.id);
      }
      semantic = channelRecord("ran", mismatched > 0 ? "ran-with-dropped-vectors" : "ran");
    }
  }

  const semanticIds = [...semanticSelected];

  const shownIds = [...new Set([...lexicalIds, ...semanticIds])];
  const overlapIds = shownIds.filter(
    (id) => lexicalIds.includes(id) && semanticIds.includes(id),
  );
  const semanticOnlyIds = semanticIds.filter((id) => !lexicalIds.includes(id));

  const shown: SelectedSchema[] = shownIds.map((id) => {
    const channels: Channel[] = [];
    if (lexicalIds.includes(id)) channels.push("lexical");
    if (semanticIds.includes(id)) channels.push("semantic");
    return { id, channels, score: scores.get(id) ?? null };
  });

  const blind = shown.length === 0;
  const events: EncodeEvent[] = [
    {
      event: "preselect.shown",
      ref: input.chunkRef,
      data: {
        lexical: lexicalIds.length,
        semantic: semanticIds.length,
        overlap: overlapIds.length,
        shown: shown.length,
        candidates: schemas.length,
        semanticState: semantic.state,
        semanticReason: semantic.reason,
      },
    },
  ];
  if (blind) {
    // Counted, by id-less event: a blind chunk is a FACT about coverage.
    events.push({
      event: "preselect.blind",
      ref: input.chunkRef,
      data: { candidates: schemas.length, semanticState: semantic.state },
    });
  }

  return {
    chunkRef: input.chunkRef,
    shown,
    lexicalIds,
    semanticIds,
    overlapIds,
    semanticOnlyIds,
    blind,
    semantic,
    candidates: schemas.length,
    floor,
    cap,
    events,
  };
}

/**
 * What the author is shown, rendered (§8 G6, G7).
 *
 * - Beliefs and current state render VERBATIM, for every shown schema: a
 *   paraphrase of a belief cannot be honestly confirmed or contradicted.
 * - Identity core renders COMPRESSED, under a byte budget, and the elision is
 *   announced as a count rather than hidden.
 * - A semantic-only slice is framed as "named in — or closely related to — this
 *   span", never as "mentioned": the author is never told something false about
 *   why a slice is present.
 * - **The whole render leaves through the secrets gate.** This is a prompt, and a
 *   prompt is not exempt (§5 G1). A belief carrying a credential is redacted on
 *   its way to the author's eyes, not just on its way to disk.
 */
export function renderSchemaContext(
  pre: Preselection,
  schemas: readonly SchemaSlice[],
  budget: number = TUNABLES.IDENTITY_CORE_BUDGET,
): string {
  const byId = new Map(schemas.map((s) => [s.id, s]));
  const lines: string[] = [];
  for (const sel of pre.shown) {
    const s = byId.get(sel.id);
    if (s === undefined) continue;
    const framing = sel.channels.includes("lexical")
      ? "named in this span"
      : "named in — or closely related to — this span";
    lines.push(`## ${s.name} (${framing})`);
    // The id is the belief's ADDRESS: shown so a contradiction can be DECLARED
    // (`updates: <id>`) rather than loosely restated — declared revisions are
    // what the accommodation path resolves first.
    for (const b of s.beliefs ?? []) {
      const addr = sliceAddressOf(b);
      lines.push(
        addr === null ? `- belief: ${sliceStatementOf(b)}` : `- belief [${addr}]: ${sliceStatementOf(b)}`,
      );
    }
    for (const c of s.currentState ?? []) {
      const addr = sliceAddressOf(c);
      lines.push(
        addr === null ? `- now: ${sliceStatementOf(c)}` : `- now [${addr}]: ${sliceStatementOf(c)}`,
      );
    }
    const core = s.identityCore ?? "";
    if (core.length > 0) {
      if (core.length <= budget) lines.push(core);
      else {
        lines.push(core.slice(0, budget));
        lines.push(`[… ${core.length - budget} further characters elided]`);
      }
    }
  }
  if (lines.length === 0) lines.push("(no schemas matched this span)");
  return redactSecrets(lines.join("\n"));
}
