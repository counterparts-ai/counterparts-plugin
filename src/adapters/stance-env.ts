/**
 * `COUNTERPARTS_OBSERVER` and `COUNTERPARTS_OWNER`, read the way the guard next
 * door is read — and failing in the direction each of them is *for*.
 *
 * THE DEFECT (LAUNCH-STATUS G39). Two adapters matched these variables by exact
 * string: `cli/commands.ts` and `mcp/bin/serve.ts#launchOptions` both accepted
 * only the untrimmed `"1"` and `"true"`. One directory over,
 * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` accepts `1|true|on`, trimmed and
 * case-insensitive, and `store/paths.ts` says in a comment that observer is
 * "deliberately NOT widened" *pending its own ruling* — because #80 promised to
 * leave the live MCP server's launch path instruction-for-instruction identical
 * and would not spend that promise on an unrelated variable. G39 is that ruling
 * (HANDOFF 2026-09-08 item 4), and this module is where it lands.
 *
 * So `COUNTERPARTS_OBSERVER=True`, `=on`, or `= 1 ` — every one of which a
 * person who read the guard's own documentation would reasonably type — now
 * mean what they look like instead of silently meaning "ordinary session".
 * The arming and disarming word lists are IMPORTED from the guard rather than
 * retyped: two lists that must agree and are written twice have already begun
 * to disagree.
 *
 * THE TWO FAIL DIRECTIONS ARE OPPOSITE, AND BOTH ARE "LESS POWER".
 *
 *   - **Observer: junk ⇒ observer.** `docs/observer-mode.md` G5, "fail toward
 *     standing down: a config-load failure resolves to observer", mechanized in
 *     in `core/observer.ts`'s predicate — an unreadable stance value there already
 *     resolves to observer rather than to "encode anyway". A variable this
 *     cannot read is an unreadable stance, so it resolves the same way. Note
 *     that this is the OPPOSITE of the explicit-dir guard's junk handling, which
 *     REFUSES the process outright, and deliberately: refusing is fail-closed
 *     for a guard whose whole job is to stop a run, and standing down is
 *     fail-closed for a stance whose whole job is to withhold writes. An
 *     observer MCP server still answers every read; a refused one answers
 *     nothing and the host reports "MCP server failed". Withholding the writes
 *     is the smaller, more recoverable failure, and it is the one the module's
 *     own doctrine already names.
 *   - **Owner: junk ⇒ not owner.** Same principle, opposite boolean, because
 *     the boolean's polarity is opposite: `owner` GRANTS reach and `observer`
 *     WITHHOLDS it, so least privilege is `false` for one and `true` for the
 *     other. It is the same helper either way — only the collapse of the
 *     malformed case differs, one line apart, which is why they are read here
 *     together rather than one of them being left behind.
 *
 * Junk is never silent in either direction: the reading carries the text, and
 * the caller prints one line (`unreadableStanceLine`) on the surface it has —
 * stderr for the MCP server, `io.err` for the console. A stance that changed
 * because a shell had a typo in it must be legible in the transcript, or the
 * next person debugs the tool instead of the variable (scar §2.4).
 */
import { EXPLICIT_DIR_ARMING_VALUES, EXPLICIT_DIR_DISARMING_VALUES } from "../core/store/index.js";

export const OBSERVER_ENV = "COUNTERPARTS_OBSERVER";
export const OWNER_ENV = "COUNTERPARTS_OWNER";

/** What a boolean environment variable says, read without judgement. */
export type EnvSwitch =
  /** `1`, `true` or `on`. */
  | { readonly state: "on" }
  /** `0`, `false` or `off` — present, and saying no. */
  | { readonly state: "off" }
  /** Unset, or blank. */
  | { readonly state: "absent" }
  /** Present and not a word this reads; `value` is the text, as typed after trimming. */
  | { readonly state: "malformed"; readonly value: string };

/**
 * The same three readings the explicit-dir guard takes, from the same two word
 * lists: trimmed, case-insensitive, blank is absent. Pure; never throws.
 */
export function readEnvSwitch(
  env: Record<string, string | undefined>,
  name: string,
): EnvSwitch {
  const raw = (env[name] ?? "").trim();
  if (raw.length === 0) return { state: "absent" };
  const word = raw.toLowerCase();
  if (EXPLICIT_DIR_ARMING_VALUES.includes(word)) return { state: "on" };
  if (EXPLICIT_DIR_DISARMING_VALUES.includes(word)) return { state: "off" };
  return { state: "malformed", value: raw };
}

/** A stance bit, and the text that could not be read if there was one. */
export interface StanceReading {
  readonly on: boolean;
  /** Null unless the variable held something this would not guess at. */
  readonly malformed: string | null;
}

/**
 * OBSERVER. A flag beats the environment; junk STANDS DOWN (G5, above).
 */
export function observerFromEnv(
  env: Record<string, string | undefined>,
  flag = false,
  name: string = OBSERVER_ENV,
): StanceReading {
  const reading = readEnvSwitch(env, name);
  if (flag) return { on: true, malformed: reading.state === "malformed" ? reading.value : null };
  switch (reading.state) {
    case "on":
      return { on: true, malformed: null };
    case "malformed":
      return { on: true, malformed: reading.value };
    default:
      return { on: false, malformed: null };
  }
}

/**
 * OWNER. A flag beats the environment; junk is NOT owner — least privilege
 * again, and for this variable least privilege is the other boolean.
 */
export function ownerFromEnv(
  env: Record<string, string | undefined>,
  flag = false,
  name: string = OWNER_ENV,
): StanceReading {
  const reading = readEnvSwitch(env, name);
  if (flag) return { on: true, malformed: reading.state === "malformed" ? reading.value : null };
  return {
    on: reading.state === "on",
    malformed: reading.state === "malformed" ? reading.value : null,
  };
}

/**
 * The one sentence a surface prints when a stance variable could not be read.
 * It names the variable, quotes the value as typed, says what it did INSTEAD,
 * and lists the words that work — so the remedy needs no second document.
 */
export function unreadableStanceLine(name: string, value: string, resolvedTo: string): string {
  return (
    `[counterparts] ${name} is set to '${value}', which is not a value this reads — ` +
    `${resolvedTo}. It takes ${EXPLICIT_DIR_ARMING_VALUES.join(", ")} for yes and ` +
    `${EXPLICIT_DIR_DISARMING_VALUES.join(", ")} for no (case and surrounding whitespace ignored).`
  );
}
