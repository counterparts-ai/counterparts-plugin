/**
 * A MEMORY ABOUT THIS SYSTEM'S OWN PLUMBING (2026-11-04, TC1) — a memory
 * whose SUBJECT is a refused or denied call to this memory's own tools, or
 * what the session it was written in could not do (a slash command it cannot
 * run, a tool it lacks). Seen twice live: in Dana's week (11-03) and the
 * developer week (11-04) the session wrote "Morning share told to Theo but
 * reflect 'told' call was permission-denied", dated and marked `us`, and it
 * led Coming up in every folder for the rest of the week.
 *
 * Not a filter on what is kept: the memory still lands. What its subject
 * cannot claim is the standing a life event has — a date that comes back, an
 * open thread, a mark that it is about me, us or the owner
 * (`counterpart-deposit.ts` applies it, the door says so). The person's own
 * words about a prompt are theirs (WP1's rule): `saidBy: owner` is never read
 * as plumbing.
 *
 * WHAT IS READ: the subject only — the title, or the text's first line when
 * there is no title — never the whole body. A real memory may mention a
 * refusal in passing ("deadline Friday; I couldn't set the reminder") and
 * keeps its date; one whose headline IS the refusal does not.
 *
 * AND ONLY THIS SYSTEM'S OWN NOUNS (review of #751): a refusal word alone is
 * ordinary English ("Visa permission denied; consulate call on the 12th",
 * "mcp__github was blocked by SSO", "the CI tool wasn't granted access"). A
 * subject is read as plumbing when a refusal sits with one of: a counterparts
 * tool named as a tool (`reflect`, `session_end`, `mcp__counterparts…`,
 * "counterparts" followed by a tool, "tool" or "call", or `remember`/`recall`/
 * `dream`/… followed by "call", "tool" or a phase), a reflect phase's call
 * with reflect named ("reflect's join call"), marking a share told or delivered,
 * or the host's own tool for this session ("the Bash tool call"). Apart from a
 * refusal: a slash command the session couldn't run, and a session with no
 * file or shell tools.
 *
 * Pure: no store, no clock. The cue it returns is the pattern's name, for the
 * row's meta and the door's note.
 */

/** The meta key a plumbing memory carries, with the cue that read it so (`own-plumbing.ts`). */
export const OWN_PLUMBING_META_KEY = "ownPlumbing";

export type OwnPlumbingCue = "tool-refused" | "host-tool-refused" | "slash-command" | "session-tools";

/** A refusal, as a model words one: denied, blocked, not allowed, needs approval. */
const REFUSED =
  /\b(?:denied|blocked|refused|declined|rejected|disallowed|(?:isn't|is not|wasn't|was not|aren't|are not|weren't|were not|not)\s+(?:allowed|permitted|approved|granted)|said no|(?:needs|needed|requires|required)\s+(?:approval|permission))\b/i;

/** This memory's tools, by name. */
// Not `status`, `meet` or `scope`: "the status call was declined" is a work fact.
const TOOL = "(?:reflect|remember|recall|dream|chapter|session_end|self_page)";
/** A reflect phase a session might be asked to call. */
const PHASE = "(?:told|close|reopen|join|settle)";
const Q = "['\"`]?";

/** Where a subject names this memory's own tool as a tool (not the English word). */
const OURS: readonly RegExp[] = [
  // Unambiguous: the server's name, or a tool name no sentence uses as a word. "Counterparts" only
  // as the tools' name ("the counterparts reflect call"): "our counterparts at Acme declined" is English.
  /\bmcp__counterparts\w*|\bsession_end\b|\bself_page\b/i,
  new RegExp(`\\bcounterparts\\s+(?:${TOOL}|tools?|calls?)\\b`, "i"),
  // Quoted as a name: `reflect`, 'remember'.
  new RegExp(`['"\`]${TOOL}['"\`]`, "i"),
  // A tool with "tool", "call" or a phase after it: "the reflect tool", "reflect 'told' call", "reflect join".
  new RegExp(`\\b${TOOL}\\s+${Q}(?:tool|call|phase|${PHASE})\\b`, "i"),
  // A phase's call, quoted as a name ("'told' call") or with reflect before it ("reflect's join call");
  // not a bare "the join call with Acme" or "a close call".
  new RegExp(`['"\`]${PHASE}['"\`]\\s+call\\b|\\breflect\\b[^.;\\n]{0,30}?\\b${PHASE}\\s+call\\b`, "i"),
  // Reflect straight before or after the refusal: "reflect wasn't allowed", "permission denied for reflect".
  /\breflect\s+(?:(?:isn't|is not|wasn't|was not|was|got)\s+)?(?:allowed|permitted|approved|granted|denied|blocked|refused)\b/i,
  /\b(?:denied|blocked|refused|declined)\s+for\s+(?:the\s+)?(?:reflect|session_end|self_page)\b/i,
  // Marking a share, a note or a reflection told, delivered, shared: the bookkeeping itself
  // (not "marked the boxes as delivered").
  /\bmark(?:ed|ing)?\s+(?:the|a|that|this|last night's)\s+(?:morning\s+)?(?:share|note|reflection)\b[^.;\n]{0,20}?\b(?:as\s+)?(?:told|delivered|shared|passed on)\b/i,
];

/** The host's own tools for this session, named as tools: "the Bash tool call". */
const HOST_TOOL = /\b(?:bash|shell|edit|write|read|webfetch|websearch)\s+tool(?:[- ]calls?)?\b/i;

/** Ordered: the first that reads the subject names the cue. */
const CUES: readonly { readonly cue: OwnPlumbingCue; readonly reads: (s: string) => boolean }[] = [
  { cue: "tool-refused", reads: (s) => REFUSED.test(s) && OURS.some((r) => r.test(s)) },
  { cue: "host-tool-refused", reads: (s) => REFUSED.test(s) && HOST_TOOL.test(s) },
  // A slash command the session couldn't run: "/loop is a slash command, so I couldn't", "Couldn't run /loop here".
  {
    cue: "slash-command",
    reads: (s) =>
      /\bis a slash command\b/i.test(s) ||
      (/\bslash commands?\b/i.test(s) && /\b(?:couldn't|could not|can't|cannot|unable)\b/i.test(s)) ||
      /\b(?:couldn't|could not|can't|cannot|unable to)\s+(?:run|use|invoke|start|set up|call)\s+\/[a-z][\w-]*(?![\w/.-])/i.test(s),
  },
  // What tools the session had: "that session had only memory tools", "No Bash in this session".
  {
    cue: "session-tools",
    reads: (s) =>
      /\bonly (?:had |has |have )?(?:the )?(?:memory|counterparts) tools\b/i.test(s) ||
      /\b(?:had|has|have) no (?:file|shell|bash|edit(?:ing)?) tools?\b/i.test(s) ||
      /\bno (?:bash|shell|file|edit(?:ing)?|web) (?:tools? |access )?(?:in|for) this session\b/i.test(s),
  },
];

/** The subject a memory is read by: its title, else its text's first line. */
export function subjectOf(title: string | null | undefined, content: string): string {
  const t = (title ?? "").trim();
  if (t.length > 0) return t;
  return (content.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
}

/**
 * The cue that reads this memory's subject as this system's own plumbing, or
 * null. `saidBy: owner` is always null: the person's words are theirs.
 */
export function ownPlumbingCue(input: { readonly title: string | null | undefined; readonly content: string; readonly saidBy?: string | null }): OwnPlumbingCue | null {
  if (input.saidBy === "owner") return null;
  const subject = subjectOf(input.title, input.content);
  if (subject.length === 0) return null;
  for (const c of CUES) if (c.reads(subject)) return c.cue;
  return null;
}

/**
 * What the door says beside a memory the gate read as plumbing
 * (`mcp/server-args.ts#ownPlumbingEcho`): only what was dropped, and the way
 * back for a real dated thing (review of #751).
 */
export function ownPlumbingNote(input: { readonly dropped: readonly ("eventDate" | "unresolved")[]; readonly aboutRefused: string | null; readonly id: string }): string {
  const lost = [
    ...(input.dropped.includes("eventDate") ? ["no date"] : []),
    ...(input.dropped.includes("unresolved") ? ["no open thread"] : []),
    ...(input.aboutRefused === null ? [] : [`no "${input.aboutRefused}" mark`]),
  ];
  const what = lost.length === 0 ? "no wake line names it" : `it carries ${lost.length === 1 ? lost[0] : `${lost.slice(0, -1).join(", ")} and ${String(lost[lost.length - 1])}`}, and no wake line names it`;
  return (
    `Kept, but its subject is this memory system's own plumbing (a refused tool call, a permission prompt, what this session can't do), so ${what}. ` +
    `That isn't something that happened between you and the person. If this is a real dated thing for them, save it again with \`updates: ${input.id}\` and a title that names the thing, not the refusal.`
  );
}
