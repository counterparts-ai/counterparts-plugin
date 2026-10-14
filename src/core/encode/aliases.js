import { scanSecrets } from "./secrets.js";
import { TUNABLES } from "./tunables.js";
import { occursAsWholeWord } from "./words.js";
export function gateAliases(aliases, source) {
  const declared = aliases?.length ?? 0;
  const kept = [];
  const dropped = [];
  const secretFindings = [];
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
