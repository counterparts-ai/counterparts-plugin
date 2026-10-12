/** `remove`: by id, or by search and pick, through the removal plan (moved out of `commands.ts`, 2026-10-11). */
import { ID_PREFIX, Store, storeExists } from "../../core/store/index.js";
// `removalRefusal` is step 1 of a plan on its own — the console's picker asks it
// of every search hit before it offers one, and of every pick before it asks the
// one question. It is an extraction from `planRemoval`, never a second rule.
import { planRemoval, ownerRemoval, removalRefusal } from "./removal.js";
import type { RemovalPlan } from "./removal.js";
// The console's shared manners (2026-09-21): is there a person here, ask them,
// and say one marked line back.
import { isInteractive, confirm, isPromptAborted, ask } from "./ui.js";
import { EXIT, openStoreAt, describeDirRefusal } from "./commands-shared.js";
import type { Io } from "./commands-shared.js";

// ── remove ──────────────────────────────────────────────────────────────────

/**
 * THE LOUD REMOVAL, and since 2026-09-22 it has two doors into the same path
 * (the owner's answer 7 after the 0.2.0 trial).
 *
 *   - **The scripted door** — `--confirm`, or any console that cannot ask (a
 *     pipe, a CI job, a test with no answers): exactly what it did before the
 *     other door existed. The plan, then the typed-back id, or the dry run that
 *     says to re-run with `--confirm`.
 *   - **The interactive door** — a terminal with no `--confirm`: it asks for an
 *     id or for words to search for, numbers what it finds, takes a pick, and
 *     asks ONCE.
 *
 * Nothing about the destruction path changes between them, and nothing about it
 * changed to add the second: `removal.ts` still plans, records, darkens and
 * chases in that order, and this is a front door. Nothing about it is fast
 * either, and that is the design: removal has never fired in production in any
 * generation (§7 OQ2), which by scar §2.17's own criterion makes it unproven
 * rather than sound. The friction is what makes it safe to have at all.
 */
export async function removeCommand(
  dir: string,
  io: Io,
  env: Record<string, string | undefined>,
  positional: readonly string[],
  flags: Record<string, string | boolean | undefined>,
  now: () => number,
): Promise<number> {
  // WHICH DOOR — `isInteractive`, the same test `install` splits on, and not a weaker one.
  //
  // The first version of this asked `io.prompt === undefined`, which is stdin
  // alone (`bin/counterparts.ts` binds the prompt on `process.stdin.isTTY`).
  // The adversarial review took that apart on the command that can least afford
  // it (B1): with stdout redirected to a file the question `readline` writes
  // goes into the FILE, so `counterparts remove <id> > log` asked nothing a
  // person could see and deleted the memory on the `y` they were typing for
  // something else — and a CI job with a pty got a live delete where it had
  // always got a dry run. `isInteractive` wants the prompt, BOTH streams to be
  // terminals, and `CI` unset, so every pipe, every redirect, every CI job and
  // every test console falls to the scripted door exactly as before.
  //
  // It also keeps the dry run reachable at a terminal — `remove <id> | cat` —
  // which is what `--strike-by-content-across-scopes`'s own help tells a person
  // to look at first.
  if (flags["confirm"] === true || !isInteractive(io, env)) {
    return removeByIdCommand(dir, io, positional[0], flags, now);
  }
  return removeInteractively(dir, io, positional, flags, now);
}

/** The two plan knobs, read once and shared by both doors. */
function removalPlanOptions(
  flags: Record<string, string | boolean | undefined>,
): { crossScopeContent: boolean; echoScanMax?: number } {
  const crossScopeContent = flags["strike-by-content-across-scopes"] === true;
  // HOW MANY EPISODES THE JOURNAL-ECHO CHECK READS. Injectable so the bound can
  // be proved REPORTED rather than silent; absent, the module's own applies.
  const echoScanRaw = typeof flags["echo-scan"] === "string" ? Number(flags["echo-scan"]) : NaN;
  return {
    crossScopeContent,
    ...(Number.isFinite(echoScanRaw) && echoScanRaw >= 0
      ? { echoScanMax: Math.floor(echoScanRaw) }
      : {}),
  };
}

/**
 * THE SCRIPTED DOOR, unchanged since before the interactive one existed: the
 * plan, then `--confirm` plus the id typed back, or a dry run that changes
 * nothing. Every sentence it prints is the sentence it printed, because a script
 * reading this output is a caller nobody can ask about a rewording.
 */
async function removeByIdCommand(
  dir: string,
  io: Io,
  raw: string | undefined,
  flags: Record<string, string | boolean | undefined>,
  now: () => number,
): Promise<number> {
  // TRIMMED, on BOTH doors and in the same place (review m4). `remove "mem_x "`
  // used to remove through one door and say `unknown-id` through the other,
  // which is a console disagreeing with itself about which id was named. It can
  // only ever turn a refusal into the removal of the id plainly typed: a lookup
  // of `"mem_x "` matches no row, here or anywhere.
  const targetId = raw?.trim();
  if (targetId === undefined || targetId.length === 0) {
    io.err("remove needs a memory id");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }

  const planOpts = removalPlanOptions(flags);

  // THE PLAN, made read-only and with no lock held (scar E5).
  const planning = openStoreAt({ dir, observer: true });
  let plan;
  try {
    plan = planRemoval(planning, targetId, planOpts);
  } finally {
    planning.close();
  }
  if (!plan.valid) {
    io.err(removalRefusalLine(plan.reason, targetId));
    return EXIT.refused;
  }

  printRemovalPlan(io, plan);

  if (flags["confirm"] !== true) {
    io.out("");
    io.out("Dry run. Nothing has changed. Re-run with --confirm to remove.");
    return EXIT.ok;
  }
  if (io.prompt === undefined) {
    io.err("refused: removal requires an interactive confirmation and this console has no prompt.");
    return EXIT.refused;
  }
  const answer = (await io.prompt(`Type the id to remove it permanently [${targetId}]: `)).trim();
  if (answer !== targetId) {
    io.err("refused: the confirmation did not match. Nothing has changed.");
    return EXIT.refused;
  }

  // RELOAD AND RE-PLAN under the writing store: the human took time, and the
  // store may not be the store the plan was made against.
  const store = openStoreAt({ dir });
  try {
    const outcome = removeOne(store, io, targetId, flags, now, planOpts, "scripted");
    return outcome === "removed" ? EXIT.ok : outcome === "refused" ? EXIT.refused : EXIT.failed;
  } finally {
    store.close();
  }
}

/**
 * ONE MEMORY, THROUGH THE ONE PATH — re-planned under the writing store, removed,
 * and reported. Both doors call this and nothing else calls `ownerRemoval`, so
 * the front door a person came through cannot change what happens to the memory
 * or what is said about it afterwards.
 *
 * `door` exists for one sentence and is not decoration. It was derived from a
 * count of what had already gone — `removedSoFar === 0` — and the adversarial
 * review (M1) showed what that costs: a refusal on the FIRST of two picks reads
 * "none gone yet" as "none will be", prints the single-target door's *"Nothing
 * has changed."*, and the loop then removes the second one. The person is told
 * nothing changed and a memory is deleted under the sentence. A report that
 * overstates what survived is the same failure as one that overstates what was
 * chased (§16 G15), pointed the other way. The door is a fact about the caller,
 * so it is passed as one.
 */
function removeOne(
  store: Store,
  io: Io,
  targetId: string,
  flags: Record<string, string | boolean | undefined>,
  now: () => number,
  planOpts: { crossScopeContent: boolean; echoScanMax?: number },
  door: "scripted" | "picked",
): "removed" | "refused" | "failed" {
  try {
    const replan = planRemoval(store, targetId, planOpts);
    if (!replan.valid) {
      io.err(
        door === "scripted"
          ? `refused after re-plan: ${replan.reason}. Nothing has changed.`
          : // NAMED, and claiming nothing about the rest of the batch: the
            // tail line at the end of the loop counts what happened, and it is
            // the only sentence in a position to be true about all of it.
            `refused after re-plan: ${replan.reason} (${targetId}). That memory is untouched.`,
      );
      return "refused";
    }
    const outcome = ownerRemoval(
      store,
      {
        targetId,
        actor: "owner",
        reason: typeof flags["reason"] === "string" ? flags["reason"] : "owner request",
        requestedAt: now(),
      },
      { ...planOpts, onEvent: (name, data) => io.out(`  ${name} ${JSON.stringify(data)}`) },
    );
    io.out("");
    io.out(`Removed ${targetId}.`);
    io.out(`  chased: ${outcome.chased.join(", ") || "nothing"}`);
    io.out(`  unchased (dark via the deny-list, never silently dropped): ${outcome.unchased.join(", ") || "nothing"}`);
    io.out(`  left on purpose (not a failure — this removal was never entitled to it): ${outcome.leftAlone.join(", ") || "nothing"}`);
    io.out(`  removal record: ${outcome.notes.length} stages appended`);
    return "removed";
  } catch (err) {
    io.err(`removal failed: ${describeDirRefusal(err)}`);
    return "failed";
  }
}

/**
 * WHAT A REMOVAL WILL AND WILL NOT REACH — the same block through both doors.
 *
 * It was the scripted door's alone until the adversarial review's M3: the person
 * at the terminal is the LESS expert caller and was getting strictly less before
 * the irreversible yes than the scripted one got. `removal.ts`'s own comment on
 * `SpanSurface.matchedBy` settles it — *"printed, because the two are not
 * equally strong and a reader deciding whether to confirm deserves to know which
 * one is about to run"* (review F4). Sharpest with
 * `--strike-by-content-across-scopes`, which the interactive door honours and
 * which chases a body through every project's buffer on the machine.
 */
function printRemovalPlan(io: Io, plan: RemovalPlan): void {
  io.out(`Removal plan for ${plan.targetId}:`);
  for (const surface of plan.surfaces) io.out(`  chase ${surface.surface}: ${surface.count}`);
  // The seventh surface, printed in ALL THREE states and ABOVE the closing
  // "Nothing has changed" line — a disclosure under the last line of a dry run
  // is a disclosure a reader has already stopped reading (cold-stranger round 3,
  // C3). `not applicable` is stated too: the silence is what made the residue
  // undiscoverable outside the README (LAUNCH-STATUS §I2). `held` is a CHASE
  // now, not a confession; only `unknown` still says NOT chased.
  io.out(
    plan.spans.state === "held"
      ? `  chased — ${plan.spans.line}`
      : plan.spans.state === "unknown"
        ? `  NOT chased — ${plan.spans.line}`
        : `  ${plan.spans.line}`,
  );
  for (const name of plan.unchasable) {
    if (name === plan.spans.line) continue; // said once, on its own line above
    io.out(`  CANNOT chase ${name} — the id goes dark via the deny-list instead`);
  }
  // LEFT ON PURPOSE, which is neither a chase nor a failure (review F6). The
  // spans sentence above already carries the count; this line is what the
  // completion report will repeat, so the two read the same.
  for (const name of plan.leftAlone) io.out(`  LEFT on purpose — ${name}`);
  // IDS ONLY (§16 G15): printing the matching text would re-leak exactly the
  // thing being removed.
  io.out(`  other memories whose text overlaps (ids only): ${plan.contamination.length}`);
  for (const id of plan.contamination) io.out(`    ${id}`);
}

/**
 * WHY AN ID CANNOT BE REMOVED, in the words both doors use.
 *
 * One refusal gets a sentence rather than a code, because it is the one that
 * means "you want a different command" rather than "that id is wrong".
 */
function removalRefusalLine(reason: RemovalPlan["reason"], targetId: string): string {
  return reason === "is-the-self-page"
    ? `refused: ${targetId} is the self page, and removal is not how a page goes away — it would tombstone the row that every session's wake and the schema index read. Unwrite it with 'counterparts self-page --clear', which keeps what it said as a version you can restore.`
    : `refused: ${reason} (${targetId})`;
}

// ── remove, the interactive door ────────────────────────────────────────────

/**
 * WHAT THIS CONSOLE TAKES FOR AN ID rather than for words to search for.
 *
 * Built from `ID_PREFIX` — the store's own table of id families — rather than
 * from a second copy of `mem|epi|sch` here, so a family added there is an id
 * here on the same day. A string shaped like an id is one: `remove
 * mem_notarealid` is a wrong id and gets told so, never quietly turned into a
 * search for the word "mem_notarealid".
 */
const MEMORY_ID_SHAPE = new RegExp(`^(?:${Object.values(ID_PREFIX).join("|")})_[0-9a-z]+$`);

/**
 * Is this one token an id? CASE-SENSITIVE, and that is the answer to review n1.
 *
 * `store.row` is case-sensitive and ids are minted lowercase (`newId`, hex), so
 * `MEM_7F29…` names no row. The two ways to handle it are to lowercase before
 * the lookup — which would let one string silently become a different row's id
 * on the one command that cannot take that back — or to say it is not an id.
 * This says it is not an id.
 */
function looksLikeMemoryId(token: string): boolean {
  return MEMORY_ID_SHAPE.test(token);
}

/** How many search hits the picker offers before it says to narrow. */
const REMOVE_SEARCH_LIMIT = 10;

/** What a candidate line gives a summary before it cuts it short. */
const REMOVE_SUMMARY_WIDTH = 64;

/**
 * The one sentence every way out of the interactive door ends with — a No, an
 * Esc, an empty answer, a second bad pick. Said in the same words every time,
 * because "did that just delete something?" is the question this door exists to
 * make unnecessary.
 */
const NOTHING_DELETED = "Cancelled. Nothing was deleted.";

/**
 * THE INTERACTIVE DOOR (owner's answer 7, 2026-09-22): a person at a terminal
 * who has a thing they want gone and does not have its id in their hand.
 *
 * Ask what, find it, show it, ask once. Everything destructive still happens in
 * `removeOne` and therefore in `removal.ts`, in the order that file's header
 * sets out; this function only decides which ids get there.
 *
 * EVERY exit that is not a removal prints `NOTHING_DELETED` and returns
 * `EXIT.refused` — on `io.out`, because it is the answer to a question this
 * console asked rather than something that went wrong, and non-zero, because a
 * wrapper script must never read a cancelled removal as a removal that happened.
 */
async function removeInteractively(
  dir: string,
  io: Io,
  positional: readonly string[],
  flags: Record<string, string | boolean | undefined>,
  now: () => number,
): Promise<number> {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const planOpts = removalPlanOptions(flags);

  let chosen: readonly string[];
  let go: boolean;
  try {
    chosen = await chooseForRemoval(dir, io, positional);
    // Empty means the picker has already said why on screen — nothing matched,
    // nothing was typed, or two answers in a row were not numbers.
    if (chosen.length === 0) return EXIT.refused;

    // THE PICK, CHECKED AND PLANNED BEFORE THE CONFIRMATION. Two reasons, and
    // the second arrived with the adversarial review (M3):
    //
    //   - a person about to be asked ONE yes/no question about N memories must
    //     not have one of them turn out to be unremovable after the others are
    //     gone;
    //   - and what they are saying yes to has to be on the screen — the
    //     surfaces, the spans sentence, what is left on purpose, how many other
    //     memories overlap. The scripted caller has always had it.
    //
    // Read-only, and CLOSED before the prompt: this console never holds a store
    // across a human (scar E5).
    const inspected = inspectForRemoval(dir, chosen, planOpts);
    if (inspected.refused !== null) {
      io.err(removalRefusalLine(inspected.refused.reason, inspected.refused.id));
      io.out(NOTHING_DELETED);
      return EXIT.refused;
    }
    for (const entry of inspected.entries) {
      io.out("");
      io.out(`  ${entry.line}`);
      printRemovalPlan(io, entry.plan);
    }
    io.out("");
    go = await confirm(
      io,
      chosen.length === 1
        ? "Delete this memory for good?"
        : `Delete these ${chosen.length} memories for good?`,
      { default: false },
    );
  } catch (err) {
    if (!isPromptAborted(err)) throw err;
    // Esc, Ctrl-C, or stdin closing under the question. The prompt helpers throw
    // rather than return a null so that a forgotten check cannot read an abort
    // as an answer (`ui.ts#PromptAborted`); here an abort means exactly what a
    // No means, and says so in the same words.
    io.out(NOTHING_DELETED);
    return EXIT.refused;
  }
  if (!go) {
    io.out(NOTHING_DELETED);
    return EXIT.refused;
  }

  // ONE writing store for the whole selection, and each memory re-planned under
  // it on its own — the human took time, and the store may have moved since the
  // lines above were printed.
  const store = openStoreAt({ dir });
  let removed = 0;
  let refused = 0;
  let failed = 0;
  try {
    for (const targetId of chosen) {
      // A REFUSAL IS REPORTED AND THE LOOP GOES ON, deliberately. The person
      // confirmed these memories; the ones after a hiccup are no less confirmed
      // than the ones before it, and the ordinary cause — another session got
      // to that id first — says nothing at all about the rest. Stopping would
      // leave them with neither a removal nor a sentence.
      const outcome = removeOne(store, io, targetId, flags, now, planOpts, "picked");
      if (outcome === "removed") removed += 1;
      else if (outcome === "refused") refused += 1;
      else failed += 1;
    }
  } finally {
    store.close();
  }
  if (refused + failed > 0) {
    // THE ONLY SENTENCE IN A POSITION TO BE TRUE ABOUT ALL OF IT, which is why
    // the per-memory refusal above claims nothing about the batch (review M1).
    io.out("");
    io.out(
      `${removed} of ${chosen.length} removed. The ${refused + failed} not removed ${refused + failed === 1 ? "is" : "are"} untouched, and named above.`,
    );
  }
  // REFUSED AND BROKEN ARE DIFFERENT ANSWERS (review m2): the scripted door
  // exits `refused` for a re-plan refusal, and a wrapper told `failed` for the
  // same condition has been told the wrong thing.
  return failed > 0 ? EXIT.failed : refused > 0 ? EXIT.refused : EXIT.ok;
}

/**
 * WHICH MEMORIES THE PERSON MEANS. Ids out; nothing here writes or deletes.
 *
 * Empty means "stop, and the reason is already printed". The caller turns that
 * into an exit code and nothing else.
 */
async function chooseForRemoval(
  dir: string,
  io: Io,
  positional: readonly string[],
): Promise<readonly string[]> {
  const typed = positional.map((word) => word.trim()).filter((word) => word.length > 0);
  const named = allIds(typed);
  // SEVERAL IDS ARE SEVERAL IDS (review m3). `remove mem_a mem_b` used to be
  // joined into one search string and answered "nothing matched" — the most
  // obvious thing a person with two ids can type, refused for looking like a
  // sentence. This door already removes several; it just had no way to be told
  // two.
  if (named !== null) return named;

  const query =
    typed.length > 0
      ? typed.join(" ")
      : (await ask(io, "Memory id, or words to search for:")).trim();
  if (query.length === 0) {
    io.out(NOTHING_DELETED);
    return [];
  }
  // The same rule for what was typed AT the question, so the two ways in agree.
  const atThePrompt = allIds(query.split(/\s+/).filter((word) => word.length > 0));
  if (atThePrompt !== null) return atThePrompt;

  const found = searchForRemoval(dir, query);
  const candidates = found.candidates;
  if (candidates.length === 0) {
    // A search that finds nothing is not a failure and is not a silence: say
    // which words were asked, so a typo is visible as a typo.
    io.out(`Nothing matched “${query}”.`);
    io.out(NOTHING_DELETED);
    return [];
  }
  io.out("");
  candidates.forEach((candidate, index) => io.out(`  ${index + 1}. ${candidate.line}`));
  // TRUNCATION IS THE SEARCH'S OWN ANSWER, not a length compared to a constant
  // (review n4): a list shortened by the skipped candidates is still a list with
  // more behind it, and the old check said nothing in exactly that case.
  if (found.truncated) {
    io.out(`  (the ${candidates.length} closest — add a word or two to narrow it)`);
  }
  io.out("");

  // ONE re-ask, then stop — the same rule `ui.ts#confirm` uses, and for the same
  // reason: a person who has typed two non-answers is not reading, and a third
  // identical question is a trap rather than a kindness. Here it stops rather
  // than taking a default, because there is no safe default for "which of these
  // do I delete".
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const picks = parsePicks(await ask(io, "Which one? (a number, or several like 1,3):"), candidates.length);
    if (picks !== null) return picks.map((n) => candidates[n - 1]?.id ?? "");
    if (attempt === 0) {
      io.out(`Answer with a number from 1 to ${candidates.length}, or several like 1,3.`);
    }
  }
  io.out(NOTHING_DELETED);
  return [];
}

/**
 * Every token of `words` as an id, or null when even one of them is not.
 *
 * All or nothing on purpose: a line that is half ids and half words is a line
 * this console cannot read two ways at once, and guessing which half was meant
 * is guessing on the one command that cannot take it back.
 */
function allIds(words: readonly string[]): readonly string[] | null {
  if (words.length === 0) return null;
  if (!words.every(looksLikeMemoryId)) return null;
  // `1,1` folds and so does this: two of the same id is one memory.
  return [...new Set(words)];
}

/**
 * The numbers in an answer, or null when the WHOLE answer cannot be read as
 * numbers in range.
 *
 * Whole, deliberately: `1,99` on a list of three is not "remove 1" with a stray
 * character, it is somebody who has misread the list, and acting on the half
 * that parsed would delete a memory on the strength of a typo. The SHAPE is
 * checked before anything is split (review n3, which found `1,` parsing as
 * `[1]` — a trailing separator is an unfinished answer, and a docstring that
 * says "refused whole" has to mean it). Duplicates fold — `1,1` is one memory —
 * and both separators the owner named work, comma and space.
 */
function parsePicks(answer: string, count: number): number[] | null {
  const trimmed = answer.trim();
  if (!/^[0-9]+(?:[ \t,]+[0-9]+)*$/.test(trimmed)) return null;
  const picked: number[] = [];
  for (const part of trimmed.split(/[\s,]+/)) {
    const n = Number(part);
    if (n < 1 || n > count) return null;
    if (!picked.includes(n)) picked.push(n);
  }
  return picked;
}

interface RemovalCandidate {
  readonly id: string;
  readonly line: string;
}

/**
 * THE SEARCH BEHIND THE PICKER — the lexical index, read-only, through the same
 * `Store.search` the recall path's token channel reads (`recall/activate.ts`)
 * and `planRemoval`'s own contamination scan already uses.
 *
 * **This prints titles, and that is not the thing §16 G15 forbids.** The
 * contamination scan returns IDS ONLY because it matches OTHER memories against
 * the doomed body: printing those would re-leak the very words being erased, to
 * somebody who had asked to see them gone. This list is the opposite direction —
 * it is the answer to words the person typed a moment ago, about memories they
 * are deciding whether to keep, and a numbered list with no titles in it is a
 * list nobody can choose from. The removal's own report still prints no body,
 * and neither does the record.
 *
 * Candidates `removalRefusal` would turn away are skipped rather than numbered:
 * an already-removed row or the self page offered as choice 3 is a choice that
 * dead-ends. It asks for more hits than it shows for exactly that reason, so the
 * skipping does not quietly shorten the list.
 */
function searchForRemoval(
  dir: string,
  query: string,
): { candidates: RemovalCandidate[]; truncated: boolean } {
  const fetch = REMOVE_SEARCH_LIMIT * 2;
  const store = openStoreAt({ dir, observer: true });
  try {
    const out: RemovalCandidate[] = [];
    const hits = store.search(query, fetch);
    let truncated = hits.length === fetch;
    for (const hit of hits) {
      if (out.length === REMOVE_SEARCH_LIMIT) {
        truncated = true;
        break;
      }
      if (removalRefusal(store, hit.id) !== null) continue;
      const row = store.row(hit.id);
      if (row === undefined) continue;
      out.push({ id: hit.id, line: candidateLine(row) });
    }
    return { candidates: out, truncated };
  } finally {
    store.close();
  }
}

/**
 * THE PICK, RE-READ — is every chosen id still removable, and what does each one
 * say it is? Read-only, and the store is closed before the caller asks anything,
 * so no lock and no handle is held across a human (scar E5).
 *
 * The first refusal stops it: a selection that cannot be carried out whole is
 * refused whole, before the single confirmation rather than in the middle of it.
 */
function inspectForRemoval(
  dir: string,
  chosen: readonly string[],
  planOpts: { crossScopeContent: boolean; echoScanMax?: number },
): {
  refused: { id: string; reason: RemovalPlan["reason"] } | null;
  entries: { line: string; plan: RemovalPlan }[];
} {
  const store = openStoreAt({ dir, observer: true });
  try {
    const entries: { line: string; plan: RemovalPlan }[] = [];
    for (const id of chosen) {
      // `planRemoval` asks `removalRefusal` first and returns on it, so the
      // refusal here is the same refusal the picker filtered on — one rule,
      // asked once more now that the person has had time to pick.
      const plan = planRemoval(store, id, planOpts);
      if (!plan.valid) return { refused: { id, reason: plan.reason }, entries: [] };
      const row = store.row(id);
      entries.push({ line: row === undefined ? id : candidateLine(row), plan });
    }
    return { refused: null, entries };
  } finally {
    store.close();
  }
}

/**
 * `mem_xxx  fact — what it is about  (2026-09-22)`, and nothing wider.
 *
 * TWO MARKERS, both of them saying what a bare kind would not:
 *
 *   - **`[journal]`** — the owner's ruling of 2026-09-04 (LAUNCH-STATUS §I14),
 *     in the same place and the same word `recall` prints it: a chapter is
 *     recallable and is never presented as a memory. The lexical index holds
 *     episode rows, so without it a day's account comes up looking like a fact
 *     under a question that says "delete this memory for good".
 *   - **`[confidential]`** — review m1. `export` omits confidential memories by
 *     default *even for the owner* and makes him pass `--include-confidential`;
 *     this list may not be the one owner-facing surface that prints one of them
 *     unmarked. With the marker on, `summaryOf` also stops falling back to the
 *     body for it: a confidential memory's first line is exactly the string
 *     that door exists to keep off a screen nobody asked to see it on.
 */
function candidateLine(row: {
  id: string;
  type: string;
  kind: string;
  title: string | null;
  body: string;
  confidential: number;
  learned_on: string;
}): string {
  const marks = `${row.type === "episode" ? "[journal] " : ""}${row.confidential === 1 ? "[confidential] " : ""}`;
  return `${row.id}  ${marks}${row.kind} — ${summaryOf(row)}  (${row.learned_on})`;
}

/**
 * The title, or the body's first line when there is no title — folded to one
 * line and cut to fit, because a candidate list whose rows wrap is a list whose
 * numbers stop lining up. The cut is at a width, not at a word: this is a label
 * for choosing by, and the memory itself is one `counterparts ask --id` away.
 *
 * **A CONFIDENTIAL memory never falls back to its body** (review m1): it is
 * `(untitled)` and the marker beside it says which kind of untitled. The line
 * is then kind, date and two markers — enough to choose by, since the person
 * searched the words that found it, and none of the words themselves.
 */
function summaryOf(row: { title: string | null; body: string; confidential: number }): string {
  const titled = row.title !== null && row.title.trim().length > 0;
  if (!titled && row.confidential === 1) return "(untitled)";
  const raw = titled ? row.title ?? "" : (row.body.split("\n").find((line) => line.trim().length > 0) ?? "");
  const one = raw.replace(/\s+/g, " ").trim();
  if (one.length === 0) return "(no words)";
  return one.length <= REMOVE_SUMMARY_WIDTH ? one : `${one.slice(0, REMOVE_SUMMARY_WIDTH - 1)}…`;
}
