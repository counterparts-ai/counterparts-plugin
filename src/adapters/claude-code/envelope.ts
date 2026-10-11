/**
 * THE HOOK ENVELOPE'S SHAPE, in one place (2026-09-29, review of #285, S2).
 *
 * `bin/hook.ts#hostDelivery` prints it. A person-facing line (a plain
 * reminder, a doctor notice) reaches the terminal only inside this JSON form.
 * Since 2026-10-10 each of its fields is measured on its own against
 * `TUNABLES.HOST_OUTPUT_CHARS`, as the host measures it (`bin/hook.ts#fieldsFit`),
 * so `hooks.ts` sizes the model's text the same way in either form and no
 * longer measures the escaped object (`escapedBytes` went with that).
 */

/**
 * The host's own spelling of the event that carries a notice at a session's
 * start. It appears twice — as a key in the hook's event map, and as
 * `hookSpecificOutput.hookEventName` in the JSON form — and the host matches
 * that field against its own name, so the two spellings must be one constant.
 */
export const HOST_SESSION_START = "SessionStart";

/** The same, for a prompt (the update notice, plain reminders, the dream offer). */
export const HOST_USER_PROMPT_SUBMIT = "UserPromptSubmit";

/** The JSON form of an envelope: the person's line(s) and the model's context. */
export function envelopeJson(hookEventName: string, systemMessage: string, additionalContext: string): string {
  return JSON.stringify({
    systemMessage,
    hookSpecificOutput: { hookEventName, additionalContext },
  });
}
