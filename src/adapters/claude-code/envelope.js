export const HOST_SESSION_START = "SessionStart";
export const HOST_USER_PROMPT_SUBMIT = "UserPromptSubmit";
export function envelopeJson(hookEventName, systemMessage, additionalContext) {
  return JSON.stringify({
    systemMessage,
    hookSpecificOutput: { hookEventName, additionalContext }
  });
}
