/**
 * The emotion gate — STATED-ONLY, and the exemption cannot widen.
 *
 * A typed feeling survives only if the span STATES it: a cited quote the span
 * contains, plus a named subject. The quote is stripped before the feeling
 * becomes durable (§3) — the feeling is what gets kept, not the sentence that
 * evidenced it.
 *
 * THE ONE EXEMPTION (§5 G5, behavioral-spec §3 G5). Exactly one recognized
 * provenance: the author stating its OWN feeling about its OWN span. It is
 * - **set per proposal by the engine that minted it** — `selfAuthoredFeeling` is
 *   an INPUT here; encode never infers it from the content, because inferring it
 *   is precisely how an exemption widens;
 * - valid only when the subject is the author itself and the feeling is non-empty;
 * - never available to a claim about someone ELSE's interior, which always takes
 *   the ordinary path, where a transcript exists to check it against.
 *
 * Absent means NULL, never neutral. And encode never assigns a type to an untyped
 * feeling: retro-typing emotion is forbidden (§3, behavioral-spec §4.2 G5).
 *
 * The emotion CLASSIFIER — the channel that would detect feeling from text — is a
 * different thing entirely and ships DISABLED (TUNABLES). The gate below runs on
 * every proposal regardless; the classifier's stand-down is its own record, so
 * "the channel is off" is never mistaken for "the gate found nothing".
 */

import { redactSecrets, scanSecrets } from "./secrets.js";
import { SELF_SUBJECT } from "./types.js";
import type { ChannelRecord, DurableFeeling, Feeling, SecretFinding } from "./types.js";
import { TUNABLES } from "./tunables.js";

export type EmotionVerdict =
  | "accepted"
  | "accepted-by-exemption"
  | "no-feeling-declared"
  | "feeling-untyped"
  | "feeling-unattributed"
  | "quote-missing"
  | "quote-not-in-span"
  | "exemption-not-available";

export interface EmotionGateResult {
  /** Null whenever the feeling did not survive. NEVER a neutral stand-in. */
  feeling: DurableFeeling | null;
  verdict: EmotionVerdict;
  exemption: boolean;
  quoteStripped: boolean;
  secretFindings: SecretFinding[];
}

export function gateEmotion(
  feeling: Feeling | null | undefined,
  span: string,
  selfAuthored: boolean | undefined,
): EmotionGateResult {
  const none = (verdict: EmotionVerdict, exemption = false): EmotionGateResult => ({
    feeling: null,
    verdict,
    exemption,
    quoteStripped: false,
    secretFindings: [],
  });

  if (feeling === null || feeling === undefined) return none("no-feeling-declared");

  const type = feeling.type.trim();
  const subject = feeling.subject.trim();
  const quote = feeling.quote.trim();

  // Untyped is not neutral, and encode will not supply the type.
  if (type.length === 0) return none("feeling-untyped");
  if (subject.length === 0) return none("feeling-unattributed");

  const claimsExemption = selfAuthored === true;
  const subjectIsAuthor = subject.toLowerCase() === SELF_SUBJECT;

  if (claimsExemption && !subjectIsAuthor) {
    // The engine set the flag on a claim about someone else's interior. Refused
    // AT THE REFUSAL SITE, structurally — the exemption cannot widen.
    return none("exemption-not-available");
  }

  const exemption = claimsExemption && subjectIsAuthor;

  if (!exemption) {
    if (quote.length === 0) return none("quote-missing");
    if (!span.includes(quote)) return none("quote-not-in-span");
  }

  // The type and subject are the only things that become durable, and both are
  // author-supplied text, so both leave through the gate.
  const scan = scanSecrets(`${type} ${subject}`, "feeling");
  return {
    feeling: { type: redactSecrets(type), subject: redactSecrets(subject) },
    verdict: exemption ? "accepted-by-exemption" : "accepted",
    exemption,
    quoteStripped: quote.length > 0,
    secretFindings: scan.findings,
  };
}

/**
 * The classifier channel's record. It ships off (§4: "do not enable a channel on
 * a rewrite's promise"), and OFF IS SILENCE, not a skip — a distinct record from
 * a failure, and a distinct record from "the gate ran and found nothing".
 */
export function emotionClassifierRecord(enabled?: boolean): ChannelRecord {
  const on = enabled ?? TUNABLES.EMOTION_CLASSIFIER_ENABLED;
  // No classifier is implemented in v2 yet, so "on" cannot honestly report "ran".
  // Asking for a channel that is not there is a SKIP (loud); leaving it off is
  // silence. Conflating the two is the exact confusion §5 G8 forbids.
  return {
    channel: "emotion-classifier",
    state: on ? "skipped" : "off",
    reason: on
      ? "enabled-but-no-classifier-shipped"
      : `ships-disabled-until-it-re-earns-${TUNABLES.EMOTION_CLASSIFIER_PRECISION_BAR}-fired-cue-precision`,
  };
}
