export const FROZEN_KINDS = ["self", "skill"];
export function decide(kind, source, direction) {
  if (direction === "soften")
    return { frozen: false, reason: "live-softening" };
  if (source !== "fallback")
    return { frozen: false, reason: "live-lived-salience" };
  if (!FROZEN_KINDS.includes(kind))
    return { frozen: false, reason: "live-other-kind" };
  return { frozen: true, reason: "frozen-self-claim-repeat" };
}
export function counterKey(kind, frozen) {
  return `self.claims.${kind}.${frozen ? "frozen" : "live"}`;
}
export const COUNTER_PREFIX = "self.claims.";
