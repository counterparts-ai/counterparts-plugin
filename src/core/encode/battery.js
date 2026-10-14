import { hashText } from "../store/prose.js";
import { gateAliases } from "./aliases.js";
import { emotionClassifierRecord, gateEmotion } from "./emotion.js";
import { contentFloor } from "./floor.js";
import { hedgePrecision } from "./precision.js";
import { scanSecrets } from "./secrets.js";
import { tagSalience } from "./salience.js";
import { EncodeError } from "./types.js";
export function assertNoBypassOption(opts) {
  for (const key of Object.keys(opts)) {
    if (/secret|redact|credential/i.test(key)) {
      throw new EncodeError("SECRETS_GATE_NOT_ABLATABLE", { key });
    }
  }
}
export function gateProposal(input, opts = {}) {
  assertNoBypassOption(opts);
  const p = input.proposal;
  const blockedBy = [];
  const events = [];
  const secretFindings = [];
  let secretInName = false;
  for (const handle of p.handles ?? []) {
    const scan = scanSecrets(handle, "handle");
    if (scan.fired) {
      secretInName = true;
      secretFindings.push(...scan.findings);
    }
  }
  if (secretInName)
    blockedBy.push("secret-in-name");
  const bodyScan = scanSecrets(p.content, "body");
  secretFindings.push(...bodyScan.findings);
  if (bodyScan.emptyAfterRedaction)
    blockedBy.push("empty-after-redaction");
  const hedged = hedgePrecision(bodyScan.redacted, input.span);
  const aliasResult = gateAliases(p.aliases, input.span);
  secretFindings.push(...aliasResult.secretFindings);
  const emotionResult = gateEmotion(p.feeling, input.span, p.selfAuthoredFeeling);
  secretFindings.push(...emotionResult.secretFindings);
  const floor = contentFloor(hedged.text);
  blockedBy.push(...floor.blockedBy);
  const contentHash = hashText(hedged.text);
  const secretsRecord = {
    gate: "secrets",
    ablatable: false,
    findings: secretFindings,
    contentHash,
    status: secretInName ? "rejected" : bodyScan.emptyAfterRedaction ? "rejected" : secretFindings.length > 0 ? "fired" : "clear",
    reason: secretInName ? "secret-in-name" : bodyScan.emptyAfterRedaction ? "empty-after-redaction" : secretFindings.length > 0 ? "redacted" : "no-credential-shapes-found"
  };
  const precisionRecord = {
    gate: "precision",
    ablatable: false,
    hedges: hedged.hedges,
    status: hedged.fired ? "fired" : "clear",
    reason: hedged.fired ? "hedged-unsourced-specifics" : "nothing-unsourced-to-soften"
  };
  const aliasRecord = {
    gate: "aliases",
    ablatable: false,
    declared: aliasResult.declared,
    kept: aliasResult.kept.length,
    dropped: aliasResult.dropped,
    status: aliasResult.declared === 0 ? "not-invoked" : aliasResult.dropped.length > 0 ? "refused-by-design" : "clear",
    reason: aliasResult.declared === 0 ? "no-aliases-declared" : aliasResult.dropped.length > 0 ? aliasResult.dropped[0]?.reason ?? "alias-dropped" : "all-aliases-verbatim-and-clean"
  };
  const emotionRecord = {
    gate: "emotion",
    ablatable: false,
    exemption: emotionResult.exemption,
    type: emotionResult.feeling?.type ?? null,
    quoteStripped: emotionResult.quoteStripped,
    status: emotionResult.verdict === "no-feeling-declared" ? "not-invoked" : emotionResult.feeling === null ? "refused-by-design" : emotionResult.quoteStripped || emotionResult.exemption ? "fired" : "clear",
    reason: emotionResult.verdict
  };
  const floorRecord = {
    gate: "floor",
    ablatable: false,
    chars: floor.chars,
    words: floor.words,
    minChars: floor.minChars,
    minWords: floor.minWords,
    status: floor.ok ? "clear" : "rejected",
    reason: floor.reason
  };
  const records = [
    secretsRecord,
    precisionRecord,
    aliasRecord,
    emotionRecord,
    floorRecord
  ];
  const channels = [emotionClassifierRecord(opts.emotionClassifier)];
  for (const r of records) {
    if (r.status === "clear" || r.status === "not-invoked")
      continue;
    events.push({
      event: `gate.${r.gate}`,
      ref: p.ref,
      data: { status: r.status, reason: r.reason, kind: p.kind, contentHash }
    });
  }
  if (blockedBy.length > 0) {
    const first = blockedBy[0] ?? "content-empty";
    events.push({
      event: "encode.refused",
      ref: p.ref,
      data: { reason: first, blockedBy: blockedBy.join(","), kind: p.kind }
    });
    return {
      gated: {
        ref: p.ref,
        accepted: false,
        kind: p.kind,
        reason: first,
        blockedBy,
        records
      },
      events,
      channels
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
        applied: tag.event.applied
      }
    });
  }
  if (tag.blind) {
    events.push({
      event: "encode.blind",
      ref: p.ref,
      data: { reason: input.novelty.reason, contextCount: input.novelty.contextCount }
    });
  }
  const accepted = {
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
    records
  };
  if (p.title !== undefined)
    accepted.title = p.title;
  if (p.scope !== undefined)
    accepted.scope = p.scope;
  events.push({
    event: "encode.accepted",
    ref: p.ref,
    data: { kind: p.kind, contentHash, blind: tag.blind, aliases: aliasResult.kept.length }
  });
  return { gated: accepted, events, channels };
}
