/**
 * THE MARK a dream's words carry (2026-09-26) — spelled once, here, with no
 * imports, because two modules that must not depend on each other both read
 * it: `dream/` writes it (the bundle, the launch prompt, the hand-back) and
 * `remember/spans.ts#enters` refuses any turn that carries it, so a dream can
 * never become a lived memory through the boundary sweep. The Claude Code
 * transcript reader tags such a block `dream` for the same reason.
 */
export const DREAM_MARK = "⟦counterparts:dream";

/** Does this text carry a dream's mark? */
export function carriesDreamMark(text: string): boolean {
  return text.includes(DREAM_MARK);
}
