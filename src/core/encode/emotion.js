import { redactSecrets, scanSecrets } from "./secrets.js";
import { SELF_SUBJECT } from "./types.js";
import { TUNABLES } from "./tunables.js";
export function gateEmotion(feeling, span, selfAuthored) {
  const none = (verdict, exemption = false) => ({
    feeling: null,
    verdict,
    exemption,
    quoteStripped: false,
    secretFindings: []
  });
  if (feeling === null || feeling === undefined)
    return none("no-feeling-declared");
  const type = feeling.type.trim();
  const subject = feeling.subject.trim();
  const quote = feeling.quote.trim();
  if (type.length === 0)
    return none("feeling-untyped");
  if (subject.length === 0)
    return none("feeling-unattributed");
  const claimsExemption = selfAuthored === true;
  const subjectIsAuthor = subject.toLowerCase() === SELF_SUBJECT;
  if (claimsExemption && !subjectIsAuthor) {
    return none("exemption-not-available");
  }
  const exemption = claimsExemption && subjectIsAuthor;
  if (!exemption) {
    if (quote.length === 0)
      return none("quote-missing");
    if (!span.includes(quote))
      return none("quote-not-in-span");
  }
  const scan = scanSecrets(`${type} ${subject}`, "feeling");
  return {
    feeling: { type: redactSecrets(type), subject: redactSecrets(subject) },
    verdict: exemption ? "accepted-by-exemption" : "accepted",
    exemption,
    quoteStripped: quote.length > 0,
    secretFindings: scan.findings
  };
}
export function emotionClassifierRecord(enabled) {
  const on = enabled ?? TUNABLES.EMOTION_CLASSIFIER_ENABLED;
  return {
    channel: "emotion-classifier",
    state: on ? "skipped" : "off",
    reason: on ? "enabled-but-no-classifier-shipped" : `ships-disabled-until-it-re-earns-${TUNABLES.EMOTION_CLASSIFIER_PRECISION_BAR}-fired-cue-precision`
  };
}
