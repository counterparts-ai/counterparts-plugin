import { tokenize } from "../store/index.js";
export const STRIPPERS = [
  {
    name: "system-reminder",
    why: "Host-injected context. Not the user's experience.",
    pattern: /<system-reminder>[\s\S]*?<\/system-reminder>/gi
  },
  {
    name: "command-echo",
    why: "Slash-command echoes and their stdout are the tool talking, not the turn.",
    pattern: /<(command-name|command-message|command-args|local-command-stdout|local-command-stderr)>[\s\S]*?<\/\1>/gi
  },
  {
    name: "image-placeholder",
    why: "MEASURED (v1 §9 G3): an image placeholder token surfaced an unrelated image-cache memory.",
    pattern: /\[(?:image|screenshot|attachment)[^\]]*\]/gi
  },
  {
    name: "data-uri",
    why: "Base64 payloads mint thousands of junk tokens and no meaning.",
    pattern: /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi
  },
  {
    name: "counterparts-injection",
    why: "Recall's own render. Re-cueing on it makes every surfaced memory self-confirming.",
    pattern: /<!--\s*counterparts:recall[\s\S]*?counterparts:recall\/end[^>]*-->/gi
  },
  {
    name: "tool-result-block",
    why: "Tool output is the environment answering, not the user speaking.",
    pattern: /<(function_results|tool_result)>[\s\S]*?<\/\1>/gi
  }
];
export function stripBoilerplate(text) {
  let out = text;
  const fired = [];
  for (const s of STRIPPERS) {
    const next = out.replace(s.pattern, " ");
    if (next !== out)
      fired.push(s.name);
    out = next;
  }
  return { text: out, stripped: fired };
}
export const MIN_RARITY_STORE = 2;
export function informativeness(df, storeSize) {
  if (df <= 0 || storeSize <= 0)
    return 0;
  return Math.max(0, Math.log((Math.max(storeSize, MIN_RARITY_STORE) + df) / (2 * df)));
}
export function tfFactor(tf) {
  if (tf <= 0)
    return 0;
  return 2 * tf / (tf + 1);
}
export function buildCues(input, t) {
  const counts = new Map;
  for (const tok of tokenize(input.text)) {
    if (tok.length < t.MIN_CUE_LENGTH)
      continue;
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  const cues = [];
  const seen = new Set;
  for (const [token, tf] of counts) {
    const df = input.df.get(token) ?? 0;
    const idf = informativeness(df, input.storeSize);
    if (idf <= 0)
      continue;
    const ids = input.aliases?.get(token);
    const ambiguous = ids !== undefined && ids.length >= 2;
    const weight = idf * tfFactor(tf) * (ambiguous ? t.AMBIGUOUS_WEIGHT : 1);
    if (weight <= 0)
      continue;
    seen.add(token);
    cues.push({ token, weight, tf, ambiguous, carried: false });
  }
  for (const token of input.carried ?? []) {
    if (seen.has(token))
      continue;
    const df = input.df.get(token) ?? 0;
    const idf = informativeness(df, input.storeSize);
    if (idf <= 0)
      continue;
    const ids = input.aliases?.get(token);
    const ambiguous = ids !== undefined && ids.length >= 2;
    const weight = idf * t.CARRY_DECAY * (ambiguous ? t.AMBIGUOUS_WEIGHT : 1);
    if (weight <= 0)
      continue;
    seen.add(token);
    cues.push({ token, weight, tf: 0, ambiguous, carried: true });
  }
  cues.sort((a, b) => b.weight - a.weight || (a.token < b.token ? -1 : 1));
  return cues.slice(0, t.MAX_CUES);
}
export const FEELING_WORDS = [
  "afraid",
  "angry",
  "anxious",
  "ashamed",
  "bitter",
  "dread",
  "excited",
  "frustrated",
  "grateful",
  "grief",
  "guilty",
  "happy",
  "hurt",
  "lonely",
  "nervous",
  "overwhelmed",
  "proud",
  "regret",
  "relieved",
  "sad",
  "scared",
  "stressed",
  "terrified",
  "tired",
  "upset",
  "worried"
];
const FIRST_PERSON = new Set(["i", "im", "ive", "id", "my", "mine", "myself", "we", "weve"]);
const THIRD_PERSON = new Set(["he", "she", "they", "her", "his", "their", "theyre", "you", "youre"]);
const FEELING = new Set(FEELING_WORDS);
const SUBJECT_WINDOW = 5;
function words(text) {
  return text.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 0);
}
export function detectAffect(text) {
  const toks = words(text);
  let stated = false;
  let word = null;
  for (let i = 0;i < toks.length; i++) {
    const tok = toks[i];
    if (tok === undefined || !FEELING.has(tok))
      continue;
    stated = true;
    word ??= tok;
    for (let j = i - 1;j >= Math.max(0, i - SUBJECT_WINDOW); j--) {
      const back = toks[j];
      if (back === undefined)
        continue;
      if (THIRD_PERSON.has(back))
        break;
      if (FIRST_PERSON.has(back))
        return { stated: true, selfFelt: true, word: tok };
    }
  }
  return { stated, selfFelt: false, word };
}
