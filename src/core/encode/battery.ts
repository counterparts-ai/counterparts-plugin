/**
 * The gate battery — all five checks, one battery, on every proposal, before
 * anything is durable (§5 G2, behavioral-spec §3 G3).
 *
 * ORDER matters, and only in one direction: secrets runs first, so nothing
 * downstream ever handles an unredacted credential; the floor runs last, so it
 * measures what would actually become canonical. Everything in between runs
 * REGARDLESS of whether an earlier check already refused the proposal — a
 * refusal short-circuit is how you end up with a battery that reports one reason
 * and hides three, and "all five run" stops being checkable.
 *
 * Refusals collect the same way physics' verdicts do: `blockedBy` carries every
 * reason, `reason` is the first. A refused proposal is not a failed batch (§3 G6);
 * rejection is data.
 */

import { hashText } from "../store/prose.js";
import { gateAliases } from "./aliases.js";
import { emotionClassifierRecord, gateEmotion } from "./emotion.js";
import { contentFloor } from "./floor.js";
import { hedgePrecision } from "./precision.js";
import { scanSecrets } from "./secrets.js";
import { tagSalience } from "./salience.js";
import type { NoveltyResult } from "./salience.js";
import { EncodeError } from "./types.js";
import type {
  AcceptedProposal,
  AliasGateRecord,
  ChannelRecord,
  EmotionGateRecord,
  EncodeEvent,
  FloorGateRecord,
  GateRecord,
  GatedProposal,
  PrecisionGateRecord,
  Proposal,
  RefusalReason,
  SecretFinding,
  SecretsGateRecord,
} from "./types.js";

/**
 * The battery's options. THERE IS NO KEY HERE THAT DISABLES A GATE, and the
 * runtime guard below refuses any caller that invents one — a JavaScript caller
 * with no types still cannot reach past the wall.
 */
export interface BatteryOptions {
  /** Overrides the emotion CLASSIFIER channel (not the emotion gate). */
  emotionClassifier?: boolean;
}

/**
 * Guarantee 1, enforced at runtime rather than asserted in prose: any option key
 * that so much as mentions the gate is a refusal. Types stop TypeScript callers;
 * this stops everyone else.
 */
export function assertNoBypassOption(opts: object): void {
  for (const key of Object.keys(opts)) {
    if (/secret|redact|credential/i.test(key)) {
      throw new EncodeError("SECRETS_GATE_NOT_ABLATABLE", { key });
    }
  }
}

export interface GateInput {
  proposal: Proposal;
  /** The span the proposal was written from. Never becomes durable itself. */
  span: string;
  /** Computed once per chunk and handed down (§5 G7). */
  novelty: NoveltyResult;
}

export interface BatteryOutcome {
  gated: GatedProposal;
  events: EncodeEvent[];
  channels: ChannelRecord[];
}

export function gateProposal(input: GateInput, opts: BatteryOptions = {}): BatteryOutcome {
  assertNoBypassOption(opts);
  const p = input.proposal;
  const blockedBy: RefusalReason[] = [];
  const events: EncodeEvent[] = [];
  const secretFindings: SecretFinding[] = [];

  // ── 1. secrets ────────────────────────────────────────────────────────────
  // Handles first: the ops rule (§3). A credential must never become an entity
  // the store indexes, so a secret in a NAME rejects the whole operation rather
  // than being quietly redacted into a nonsense handle.
  let secretInName = false;
  for (const handle of p.handles ?? []) {
    const scan = scanSecrets(handle, "handle");
    if (scan.fired) {
      secretInName = true;
      secretFindings.push(...scan.findings);
    }
  }
  if (secretInName) blockedBy.push("secret-in-name");

  const bodyScan = scanSecrets(p.content, "body");
  secretFindings.push(...bodyScan.findings);
  if (bodyScan.emptyAfterRedaction) blockedBy.push("empty-after-redaction");

  // ── 2. precision ──────────────────────────────────────────────────────────
  const hedged = hedgePrecision(bodyScan.redacted, input.span);

  // ── 3. aliases ────────────────────────────────────────────────────────────
  const aliasResult = gateAliases(p.aliases, input.span);
  secretFindings.push(...aliasResult.secretFindings);

  // ── 4. emotion ────────────────────────────────────────────────────────────
  const emotionResult = gateEmotion(p.feeling, input.span, p.selfAuthoredFeeling);
  secretFindings.push(...emotionResult.secretFindings);

  // ── 5. content floor ──────────────────────────────────────────────────────
  const floor = contentFloor(hedged.text);
  blockedBy.push(...floor.blockedBy);

  // ── the records: one per gate, ALWAYS, whatever happened ──────────────────
  const contentHash = hashText(hedged.text);
  const secretsRecord: SecretsGateRecord = {
    gate: "secrets",
    ablatable: false,
    findings: secretFindings,
    contentHash,
    status: secretInName
      ? "rejected"
      : bodyScan.emptyAfterRedaction
        ? "rejected"
        : secretFindings.length > 0
          ? "fired"
          : "clear",
    reason: secretInName
      ? "secret-in-name"
      : bodyScan.emptyAfterRedaction
        ? "empty-after-redaction"
        : secretFindings.length > 0
          ? "redacted"
          : "no-credential-shapes-found",
  };

  const precisionRecord: PrecisionGateRecord = {
    gate: "precision",
    ablatable: false,
    hedges: hedged.hedges,
    status: hedged.fired ? "fired" : "clear",
    reason: hedged.fired ? "hedged-unsourced-specifics" : "nothing-unsourced-to-soften",
  };

  const aliasRecord: AliasGateRecord = {
    gate: "aliases",
    ablatable: false,
    declared: aliasResult.declared,
    kept: aliasResult.kept.length,
    dropped: aliasResult.dropped,
    status:
      aliasResult.declared === 0
        ? "not-invoked"
        : aliasResult.dropped.length > 0
          ? "refused-by-design"
          : "clear",
    reason:
      aliasResult.declared === 0
        ? "no-aliases-declared"
        : aliasResult.dropped.length > 0
          ? (aliasResult.dropped[0]?.reason ?? "alias-dropped")
          : "all-aliases-verbatim-and-clean",
  };

  const emotionRecord: EmotionGateRecord = {
    gate: "emotion",
    ablatable: false,
    exemption: emotionResult.exemption,
    type: emotionResult.feeling?.type ?? null,
    quoteStripped: emotionResult.quoteStripped,
    // An exemption-accepted feeling reports "fired" even when there was no quote
    // to strip: a consumer grouping by status must be able to count exemption
    // fires, and "clear" means "found nothing to act on".
    status:
      emotionResult.verdict === "no-feeling-declared"
        ? "not-invoked"
        : emotionResult.feeling === null
          ? "refused-by-design"
          : emotionResult.quoteStripped || emotionResult.exemption
            ? "fired"
            : "clear",
    reason: emotionResult.verdict,
  };

  const floorRecord: FloorGateRecord = {
    gate: "floor",
    ablatable: false,
    chars: floor.chars,
    words: floor.words,
    minChars: floor.minChars,
    minWords: floor.minWords,
    status: floor.ok ? "clear" : "rejected",
    reason: floor.reason,
  };

  const records: GateRecord[] = [
    secretsRecord,
    precisionRecord,
    aliasRecord,
    emotionRecord,
    floorRecord,
  ];

  const channels: ChannelRecord[] = [emotionClassifierRecord(opts.emotionClassifier)];

  for (const r of records) {
    if (r.status === "clear" || r.status === "not-invoked") continue;
    events.push({
      event: `gate.${r.gate}`,
      ref: p.ref,
      data: { status: r.status, reason: r.reason, kind: p.kind, contentHash },
    });
  }

  if (blockedBy.length > 0) {
    const first = blockedBy[0] ?? "content-empty";
    events.push({
      event: "encode.refused",
      ref: p.ref,
      data: { reason: first, blockedBy: blockedBy.join(","), kind: p.kind },
    });
    return {
      gated: {
        ref: p.ref,
        accepted: false,
        kind: p.kind,
        reason: first,
        blockedBy,
        records,
      },
      events,
      channels,
    };
  }

  const tag = tagSalience(p.dimensions, p.claimedSalience, input.novelty);
  if (tag.event !== null) {
    events.push({
      event: tag.event.event,
      ref: p.ref,
      data: {
        computed: tag.event.computed,
        claimed: tag.event.claimed,
        applied: tag.event.applied,
      },
    });
  }
  if (tag.blind) {
    events.push({
      event: "encode.blind",
      ref: p.ref,
      data: { reason: input.novelty.reason, contextCount: input.novelty.contextCount },
    });
  }

  const accepted: AcceptedProposal = {
    ref: p.ref,
    accepted: true,
    kind: p.kind,
    content: hedged.text,
    contentHash,
    aliases: aliasResult.kept,
    feeling: emotionResult.feeling,
    salience: tag.salience,
    updates: p.updates ?? null,
    unresolved: p.unresolved ?? false,
    records,
  };
  if (p.title !== undefined) accepted.title = p.title;
  if (p.scope !== undefined) accepted.scope = p.scope;

  events.push({
    event: "encode.accepted",
    ref: p.ref,
    data: { kind: p.kind, contentHash, blind: tag.blind, aliases: aliasResult.kept.length },
  });

  return { gated: accepted, events, channels };
}
