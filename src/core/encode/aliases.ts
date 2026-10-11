/**
 * The alias gate.
 *
 * Every proposed retrieval alias must occur VERBATIM in the source — as a whole
 * word, by the one shared definition (words.ts) that schema birth also uses —
 * **and then pass its own secrets scan** (§3, §5 G4). The second half is not
 * belt-and-braces: an alias is as durable as body text, it is indexed, and a
 * verbatim-in-source alias can itself be a credential. `AKIA...` occurring in the
 * span is exactly the case the ordering catches.
 *
 * A dropped alias does NOT refuse the proposal. Losing a retrieval handle costs a
 * retrieval; refusing the memory costs the memory. The drop is recorded as
 * `refused-by-design` at the refusal site (§5 G11) — never inferred later from a
 * message.
 */

import { scanSecrets } from "./secrets.js";
import { TUNABLES } from "./tunables.js";
import { occursAsWholeWord } from "./words.js";
import type { SecretFinding } from "./types.js";

export type AliasDropReason =
  | "alias-empty"
  | "alias-too-short"
  | "alias-not-verbatim-in-source"
  | "alias-is-secret";

export interface AliasGateResult {
  kept: string[];
  /** By INDEX, never by text: an alias is author content (§5 G10). */
  dropped: { index: number; reason: AliasDropReason }[];
  /** Rolled into the secrets gate's record by the battery. */
  secretFindings: SecretFinding[];
  declared: number;
}

export function gateAliases(
  aliases: readonly string[] | undefined,
  source: string,
): AliasGateResult {
  const declared = aliases?.length ?? 0;
  const kept: string[] = [];
  const dropped: { index: number; reason: AliasDropReason }[] = [];
  const secretFindings: SecretFinding[] = [];

  (aliases ?? []).forEach((raw, index) => {
    const alias = raw.trim();
    if (alias.length === 0) {
      dropped.push({ index, reason: "alias-empty" });
      return;
    }
    if (alias.length < TUNABLES.ALIAS_MIN_CHARS) {
      dropped.push({ index, reason: "alias-too-short" });
      return;
    }
    if (!occursAsWholeWord(source, alias)) {
      dropped.push({ index, reason: "alias-not-verbatim-in-source" });
      return;
    }
    // Verbatim-in-source and STILL scanned. The order is the guarantee.
    const scan = scanSecrets(alias, "alias");
    if (scan.fired) {
      secretFindings.push(...scan.findings);
      dropped.push({ index, reason: "alias-is-secret" });
      return;
    }
    kept.push(alias);
  });

  return { kept, dropped, secretFindings, declared };
}
