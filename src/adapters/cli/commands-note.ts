/** The owner's own reads and writes: `note`, `ask`, `export` and `backup` (moved out of `commands.ts`, 2026-10-11). */
import { join } from "node:path";
import { STORE_EXPORT_EVENT } from "../../core/counterpart.js";
import { readChapterLead, readableDate } from "../../core/self/index.js";
import { Store, storeExists } from "../../core/store/index.js";
// The MCP adapter's deliberate-recall dispatcher, imported rather than
// re-implemented: a console with its own question path would be a second set of
// rules about what recall means. `mcp/deliberate.ts` imports nothing from here,
// so the direction stays one-way.
import { deliberateRecall, embedQuestion } from "../mcp/deliberate.js";
// A question at the console is answered in FACTS MODE, the MCP `recall`'s own
// path (2026-10-03), for the same reason — and in MEANING MODE, its other path,
// when `--mode meaning` asks for it (2026-10-09).
import { factsRecall, renderFacts } from "../mcp/facts.js";
import { meaningRecall, renderMeaning } from "../mcp/meaning.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import { CONFIG_FLAG, implicitConfigRefusal, resolveConfigPath } from "../config-path.js";
import { withEmbedderDefault } from "../config.js";
// The one answer to "is there an embedder", shared with the hook, the worker and
// the MCP server's entry point — `ask` embeds its question with it.
import { openEmbedder } from "../claude-code/embed-client.js";
import type { LiveEmbedder } from "../claude-code/embed-client.js";
import { exportStore } from "./export.js";
import { BIN } from "./install.js";
// The console's shared manners (2026-09-21): is there a person here, ask them,
// and say one marked line back.
import { paint } from "./ui.js";
import { snapshotName, snapshot } from "./snapshot.js";
import { feelingsLine } from "../feelings-line.js";
import {
  EXIT,
  openCounterpart,
  hostConfigFor,
  openStoreAt,
  openRefusalLine,
  describeDirRefusal,
} from "./commands-shared.js";
import type { Io, Parsed } from "./commands-shared.js";

// ── note / recall ───────────────────────────────────────────────────────────

/**
 * `note` and `recall` on the console — the same two acts the MCP tools offer,
 * reachable without a host.
 *
 * **They go through exactly the MCP server's doors, and that is the point.** A
 * second way to write a memory would be a second set of rules about what a
 * memory is: `noteTool` captures the words into the span buffer FIRST and then
 * deposits a draft that CLAIMS that span by hash, because without the claim the
 * end-of-session sweep finds the jot's own text sitting in the buffer and mints
 * it again — a "remember this" channel that costs two memories. `recall` calls
 * `deliberateRecall`, the same dispatcher, so the console cannot drift into a
 * softer question path than the model gets.
 *
 * The embedder is shared too since 2026-09-24 (`askEmbedder`): `ask` embeds its
 * question with the local table the configuration turns on, exactly as the MCP
 * `recall` does, and says which channel answered when it could not. `note`
 * opens its store with the same embedder, so the row it writes carries a vector
 * at once and a paraphrased `ask` finds it without waiting for the worker's
 * backfill. The store reconciles the embedder's identity against box 3's tag
 * at open, so a store tagged with another model gets no vector from here.
 * Without the table the note is stored by words alone, and says nothing of it:
 * the backfill, or `doctor`, is where a missing table is named.
 *
 * Why these exist at all: the cold-stranger review of 2026-09-04 reached the end
 * of the install page having verified that a store existed and was empty, with
 * no way to test the one thing the product is for. They hand-wrote JSON-RPC.
 * Most people will not.
 */
export async function noteCommand(
  dir: string,
  io: Io,
  parsed: Parsed,
  env: Record<string, string | undefined>,
  home: string,
  filedUnder?: string,
): Promise<number> {
  const text = parsed.positional.join(" ").trim();
  if (text.length === 0) {
    io.err('refused: note takes the text to remember, e.g. counterparts note "..."');
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}. Run 'counterparts install' first.`);
    return EXIT.failed;
  }
  let claimed: number | undefined;
  const salienceFlag = parsed.flags["salience"];
  if (typeof salienceFlag === "string" && salienceFlag.length > 0) {
    const n = Number(salienceFlag);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      io.err(`refused: --salience takes a number from 0 to 1, not '${salienceFlag}'.`);
      return EXIT.refused;
    }
    claimed = n;
  }

  const embedder = askEmbedder(parsed.flags, env, home);
  const counterpart = openCounterpart(dir, false, undefined, embedder?.embed);
  try {
    // THE STORE, FIRST, the way `status` names it. A write whose destination is
    // invisible is the shape the 2026-09-04 review found: a mistyped `--dir`
    // resolved to the default store, the note landed there, and the only line
    // printed was that something had been remembered.
    io.out(`Store: ${counterpart.store.dir}`);
    const session = "console";
    const scope = filedUnder ?? process.cwd();
    // Step 1 of 2, and the ORDER is the rule (see the docblock above).
    const captured = counterpart.captureJot({ session, scope, text });
    const ownSpanHash = captured.spans[0]?.hash ?? null;

    const draft: Record<string, unknown> = { content: text };
    if (typeof parsed.flags["kind"] === "string") draft["kind"] = parsed.flags["kind"];
    if (typeof parsed.flags["title"] === "string") draft["title"] = parsed.flags["title"];
    if (claimed !== undefined) draft["claimed"] = claimed;

    const deposit = await counterpart.submitJot(draft, {
      session,
      scope,
      ...(ownSpanHash === null ? {} : { ownSpanHash }),
    });
    if (!deposit.deposited) {
      io.err(
        `not stored: ${deposit.reason}${deposit.gate === null ? "" : ` (${deposit.gate})`}`,
      );
      return EXIT.refused;
    }
    io.out(`Remembered ${deposit.memoryId ?? "(no id)"} — ${deposit.reason}.`);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * THE EMBEDDER `ask` EMBEDS ITS QUESTION WITH (2026-09-24), or null when
 * recall by meaning is off.
 *
 * Until now the console passed no vector at all — a leftover from when the only
 * embedder was a network seat. The local table is local, so `ask` does what the
 * MCP server's entry point does (`mcp/bin/serve.ts#questionEmbedder`): read the
 * configuration, apply the embedder default, `openEmbedder`. Missing weights come
 * back as an UNAVAILABLE embedder whose every answer is null, and the question
 * is then answered by words and says so (`embed-failed`).
 *
 * The configuration is read for this ONE knob, the way `rebrief` reads a budget
 * number — never to locate a store — and LENIENTLY: a configuration this cannot
 * use is not a reason to refuse a question. So a `--config` or
 * `COUNTERPARTS_CONFIG` that will not resolve, or a default one the explicit-dir
 * guard says nobody named (`implicitConfigRefusal`), is not read, and the
 * default applies: the local table, on.
 */
export function askEmbedder(
  flags: Parsed["flags"],
  env: Record<string, string | undefined>,
  home: string,
): LiveEmbedder | null {
  const choice = resolveConfigPath(
    typeof flags["config"] === "string" ? [`${CONFIG_FLAG}=${flags["config"]}`] : [],
    env,
    home,
  );
  const readable = choice.refusal === null && implicitConfigRefusal(choice, env) === null;
  const config = withEmbedderDefault(readable ? hostConfigFor(choice.path).config : {});
  return openEmbedder(config, { env });
}

/** How many answers `ask` lists before `--full` (2026-09-24). */
export const ASK_SHOWN = 5;

/** How long an answer's text line runs on that list before it is cut. */
export const ASK_GIST_CHARS = 90;

/** Markdown heading marks off every line, and the whitespace collapsed. */
function plainLine(text: string): string {
  return text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "").replace(/\s+/g, " ").trim();
}

/**
 * An answer's text line on `ask`'s list: its title, or its first words — as
 * plain words. A chapter's heading (`## chapter 1 — lived day 2`, stacked or
 * not, either written form) is taken off the front, because `askMeta` says it
 * on the line underneath; heading marks go, whitespace collapses, and the line
 * is cut at `ASK_GIST_CHARS` with an ellipsis (owner, 2026-09-24).
 */
export function askGist(title: string | null, body: string): string {
  const titled = title === null ? "" : plainLine(readChapterLead(title).rest);
  const words = titled.length > 0 ? titled : plainLine(readChapterLead(body).rest);
  // A row that is ONLY a heading still gets a line: the heading, plainly.
  const said = words.length > 0 ? words : plainLine(title ?? body);
  return said.length <= ASK_GIST_CHARS ? said : `${said.slice(0, ASK_GIST_CHARS).trimEnd()}…`;
}

/**
 * The quieter line under an answer: what it is, when, and its id —
 * `self · chapter 1 · Wed 23 Sep 2026 · claude-opus-5-5 · lived day 2 · mem_0a1b2c3d4e5f`
 * (the model only where the heading names one).
 *
 * The DATE is the one the chapter's own heading names when it names one (a
 * chapter written since 2026-09-24 carries the day it was written, in the
 * person's zone). Otherwise it is `learnedOn`, the store's provenance date —
 * which is a UTC day (`store/index.ts#dateOf`), because a row keeps no instant
 * to take into any other zone.
 */
export function askMeta(
  m: { readonly id: string; readonly kind: string; readonly journal: boolean; readonly body: string },
  learnedOn: string | null,
): string {
  const lead = readChapterLead(m.body);
  const parts: string[] = [m.journal ? "journal" : m.kind];
  const [lo, hi] = [lead.chapters[0], lead.chapters[lead.chapters.length - 1]];
  if (lo !== undefined && hi !== undefined) {
    parts.push(lo === hi ? `chapter ${String(lo)}` : `chapters ${String(lo)}–${String(hi)}`);
  }
  const date = lead.date ?? (learnedOn === null ? "" : readableDate(learnedOn));
  if (date.length > 0) parts.push(date);
  if (lead.model !== null) parts.push(lead.model);
  if (lead.livedDay !== null) parts.push(`lived day ${String(lead.livedDay)}`);
  parts.push(m.id);
  return parts.join(" · ");
}

/**
 * Which channel answered, in plain words for `ask`'s header. The store's own
 * verdict has the last word: a store whose meaning index is held (another
 * model's vectors) or ahead of this build ranks on words alone whatever vector
 * it was handed — the no-mixing rule (`store/cache.ts#reconcileEmbedder`).
 */
function askChannel(
  semantic: string,
  verdict: string,
  embedder: LiveEmbedder | null,
): string {
  if (verdict === "held" || verdict === "cache-ahead" || verdict === "deferred") {
    return "by words only — this store's meaning index is on hold; see counterparts doctor";
  }
  if (semantic === "in-line") return "by meaning and words";
  if (semantic === "embedder-off") return "by words only — recall by meaning is off";
  if (embedder?.unavailable === "NO_WEIGHTS") return "by words only — the meaning table is not installed";
  if (embedder?.unavailable !== undefined) return "by words only — the meaning table could not be loaded";
  return "by words only — the question could not be embedded";
}

/** The deliberate look, in plain lines. Writes nothing of its own. */
export async function recallCommand(
  dir: string,
  io: Io,
  parsed: Parsed,
  env: Record<string, string | undefined>,
  home: string,
): Promise<number> {
  // THE SPELLING THE PERSON TYPED IS THE SPELLING THEY GET BACK. `ask` is the
  // listed name and `recall` the older one, and a refusal that answered
  // `counterparts ask` with "counterparts recall takes a question" would be
  // teaching a name the page does not list (2026-09-22, item 3).
  const said = parsed.command === "recall" ? "recall" : "ask";
  const idFlag = typeof parsed.flags["id"] === "string" ? parsed.flags["id"].trim() : "";
  const question = parsed.positional.join(" ").trim();
  if (idFlag.length === 0 && question.length === 0) {
    io.err(
      `refused: ${said} takes a question, e.g. ${BIN.cli} ${said} "..." — or --id <id>.`,
    );
    return EXIT.usage;
  }
  if (idFlag.length > 0 && question.length > 0) {
    io.err("refused: a question and --id are two different asks. Send one.");
    return EXIT.usage;
  }
  // THE MODE, as the MCP `recall` takes it (2026-10-09): facts unless meaning
  // is asked for by name. Read before the store opens, so a mistyped mode is a
  // refusal rather than a facts answer to a question meant for the arc. With
  // `--id` there is no question to answer in a mode, and it is not read.
  const modeFlag = parsed.flags["mode"];
  if (modeFlag !== undefined && modeFlag !== "facts" && modeFlag !== "meaning") {
    io.err(`refused: --mode is facts or meaning, not ${typeof modeFlag === "string" ? JSON.stringify(modeFlag) : "empty"}.`);
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}. Run 'counterparts install' first.`);
    return EXIT.failed;
  }

  // THE EMBEDDER, for a question only: `--id` is an exact address, and
  // embedding it would buy nothing (the MCP path's rule).
  const embedder = question.length > 0 ? askEmbedder(parsed.flags, env, home) : null;
  // Opened WITH the embedder's identity, the way `mcp/index.ts#openServer`
  // opens the server's store: the store reconciles box 3's tag at open, so a
  // held or mismatched meaning index ranks nothing rather than a cosine across
  // two models.
  //
  // AND IN OBSERVER STANCE (owner, 2026-09-25: asking is looking, and looking
  // changes nothing). A writable open here backfilled the meaning index — on a
  // fresh store, one `ask` embedded and wrote every row's vector into box 3 —
  // and asking from the dashboard runs this same function. Under observer the
  // question is still embedded and answered; nothing is written, the cache
  // included. The backfill is the worker's and the hooks' job.
  const counterpart = openCounterpart(dir, true, undefined, embedder?.embed);
  try {
    // Same rule as `note` and `status`: say which store answered.
    if (parsed.flags["json"] !== true) io.out(`Store: ${counterpart.store.dir}`);
    // A QUESTION is answered in FACTS MODE (Release B, 2026-10-03) — the same
    // path the MCP `recall` takes with `mode: "facts"` (`mcp/facts.ts`), so
    // the console cannot drift into a softer question path than the model
    // gets. Embedded in line, and every way it can decline said by name — the
    // same call the MCP `recall` makes (`mcp/deliberate.ts#embedQuestion`).
    if (idFlag.length === 0) {
      const embedded = await embedQuestion(embedder, question);
      const page = typeof parsed.flags["page"] === "string" && /^[1-9]\d*$/.test(parsed.flags["page"]) ? { page: Number(parsed.flags["page"]) } : {};
      // MEANING MODE: the arc, the MCP `recall`'s `mode: "meaning"` path. Whose
      // "I" a question about feeling means is the one thing the console adds:
      // a question typed here is the owner's, so his; one the dashboard turned
      // into my voice (`--voiced`) is mine. Its rendering is already short, so
      // there is no list form: `--json` is the payload, anything else the answer.
      if (modeFlag === "meaning") {
        const meaning = meaningRecall(
          {
            counterpart,
            sessionId: "console",
            owner: true,
            vector: embedded.vector,
            semantic: embedded.semantic,
            asker: parsed.flags["voiced"] === true ? "self" : "owner",
          },
          question,
          page,
        );
        io.out(parsed.flags["json"] === true ? JSON.stringify(meaning, null, 2) : renderMeaning(meaning));
        return EXIT.ok;
      }
      const facts = factsRecall(
        { counterpart, sessionId: "console", owner: true, vector: embedded.vector, semantic: embedded.semantic },
        question,
        page,
      );
      if (parsed.flags["json"] === true) {
        io.out(JSON.stringify(facts, null, 2));
        return EXIT.ok;
      }
      // SHORT BY DEFAULT (2026-09-24): a header in plain words and the top
      // few, numbered, two lines each. `--full` is the facts answer as the
      // model reads it — every result's labeled lines.
      if (parsed.flags["full"] === true) {
        io.out(renderFacts(facts));
        return EXIT.ok;
      }
      printAskList(
        io,
        facts,
        askChannel(facts.semantic, counterpart.store.embedderVerdict.kind, embedder),
        said,
        {
          learnedOn: (id) => facts.memories.find((m) => m.id === id)?.learned ?? null,
          dim: paint(io, env).dim,
        },
      );
      return EXIT.ok;
    }
    const result = deliberateRecall(counterpart, { handle: idFlag }, { sessionId: "console", owner: true });
    if (parsed.flags["json"] === true) {
      io.out(JSON.stringify(result, null, 2));
      return EXIT.ok;
    }
    io.out(
      `${result.path} · ${result.reason} · ` +
        // "live rows", not "live memories": the denominator counts schemas and
        // episodes too, so a store made with `install --name` reads one higher
        // than its memory count. Naming the population is cheaper than a second
        // number, and `status` prints the split.
        `${result.storeSize} live rows · returned ${result.memories.length}`,
    );
    if (result.memories.length === 0) {
      io.out("");
      // NOTHING CAME, said as a sentence rather than as an absence. A blank
      // where a memory would have been is the one output a reader cannot tell
      // from a crash, and the reason belongs in the same breath.
      io.out(`NOTHING CAME BACK — no memory has that id or that exact title.`);
      io.out(`  Ask a question instead: ${BIN.cli} ${said} "..."`);
      return EXIT.ok;
    }
    for (const m of result.memories) {
      io.out("");
      // THE JOURNAL SAYS SO (owner ruling, 2026-09-04 — LAUNCH-STATUS §I14). A
      // chapter stays recallable and is never presented as a memory; the word
      // rides in front of the kind.
      const journal = m.journal ? "[journal] " : "";
      io.out(`  ${m.id}  ${journal}${m.kind}${m.title === null ? "" : ` — ${m.title}`}`);
      // ITS STANDING, before the words (2026-09-29): earlier, corrected by,
      // replaced by, disagrees with, unsettled — so an old memory never reads as current.
      if (m.standing !== undefined) io.out(`    (${m.standing})`);
      for (const line of m.body.split("\n")) io.out(`    ${line}`);
      // The feelings on it, `you: … · me: …` (emotion part A). Read-only, and
      // a store that cannot answer simply shows none.
      let felt = "";
      try {
        const born = counterpart.store.physicsOf(m.id).birthDay;
        felt = feelingsLine(counterpart.store.feelingsFor(m.id), counterpart.store.livedDay() - born);
      } catch {
        felt = "";
      }
      if (felt !== "") io.out(`    feelings — ${felt}`);
    }
    if (result.memories.some((m) => m.journal)) {
      io.out("");
      io.out(
        "  journal = a chapter, the first-person account a memory was made from — not a memory, and outside decay and the prune.",
      );
    }
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * `ask`'s short answer (reshaped 2026-09-24, from the owner's first reading of
 * it on a real store): a header sentence, then at most `ASK_SHOWN` answers,
 * numbered, two lines each and a blank line between — the words first
 * (`askGist`), and under them a quieter line saying what it is, when, and its
 * id (`askMeta`), dimmed on a terminal that takes colour (`ui.ts#paint`: never
 * on a pipe unless FORCE_COLOR asks, never under NO_COLOR). What `--full`
 * prints is the facts answer as the model reads it (2026-10-03): the count
 * header, and every result's labeled lines — who said it, its status, when
 * it happened and when it was learned, whether it still holds.
 *
 * The count is facts mode's `matched` — every distinct fact that matched, not
 * only the page — when the result carries it.
 */
export function printAskList(
  io: Io,
  result: {
    readonly memories: readonly { readonly id: string; readonly title: string | null; readonly kind: string; readonly journal: boolean; readonly body: string; readonly faded?: boolean }[];
    readonly considered: number;
    readonly matched?: number;
  },
  how: string,
  said: string,
  opts: {
    /** The row's provenance date, by id — `askMeta`'s fallback date. */
    readonly learnedOn?: (id: string) => string | null;
    /** How the metadata line is quietened. Absent: plain. */
    readonly dim?: (s: string) => string;
  } = {},
): void {
  const found = Math.max(result.matched ?? 0, result.memories.length);
  if (found === 0) {
    io.out(`Nothing found (${how}).`);
    // A faded match is counted in `matched` and listed with the rest (2026-10-10).
    io.out(
      result.considered === 0
        ? "  Nothing in the store came near the question, so no memory was even scored."
        : `  ${result.considered} ${result.considered === 1 ? "memory was" : "memories were"} weighed and none was close enough to show.`,
    );
    io.out(`  Try words the memory itself would use, or ask for it by id: ${BIN.cli} ${said} --id <mem_...>`);
    return;
  }
  const shown = result.memories.slice(0, ASK_SHOWN);
  const counted = `${String(found)} ${found === 1 ? "memory" : "memories"} found, ${how}.`;
  io.out(found > ASK_SHOWN ? `${counted} The top ${String(ASK_SHOWN)}:` : counted);
  const dim = opts.dim ?? ((s: string) => s);
  const numberWidth = String(shown.length).length;
  shown.forEach((m, i) => {
    const mark = `  ${String(i + 1).padStart(numberWidth)}. `;
    io.out("");
    io.out(`${mark}${askGist(m.title, m.body)}`);
    // A chapter is never presented as a memory (LAUNCH-STATUS §I14): its
    // metadata line opens with `journal`.
    io.out(`${" ".repeat(mark.length)}${dim(`${askMeta(m, opts.learnedOn?.(m.id) ?? null)}${m.faded === true ? " · faded" : ""}`)}`);
  });
  io.out("");
  io.out(
    found > ASK_SHOWN
      ? "More: --full for all of them with detail, or --id <id> for one in full."
      : "More: --full for detail, or --id <id> for one in full.",
  );
}

// ── backup ──────────────────────────────────────────────────────────────────

export function backupCommand(
  dir: string,
  io: Io,
  out: string | boolean | undefined,
  now: () => number,
): number {
  if (typeof out !== "string" || out.length === 0) {
    io.err("backup needs --out <dir>");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  // §5 G8: A BACKUP NEVER THROWS — and OPENING the store is part of the backup.
  // That is the part that threw in the field: a store held by another process's
  // write transaction answered "database is locked" before `snapshot()`'s own
  // graceful path could be reached (live-verify 2026-08-25). An open that fails
  // is now an ordinary failure report with an exit code.
  let store: Store;
  try {
    store = openStoreAt({ dir, observer: true });
  } catch (err) {
    io.out(`Snapshot: none — nothing was copied.`);
    io.err(`  ${openRefusalLine(err, dir)}`);
    return EXIT.failed;
  }
  try {
    const target = join(out, snapshotName(now()));
    const report = snapshot(store, target);
    io.out(`Snapshot: ${report.target}`);
    for (const entry of report.copied) {
      io.out(`  ${entry.ok ? "ok  " : "FAIL"} ${entry.name}  (${entry.method}, ${entry.files} files)`);
    }
    for (const entry of report.excluded) io.out(`  --   ${entry.name}  — ${entry.why}`);
    for (const error of report.errors) io.err(`  ${error}`);
    // §5 G8: a backup problem is reported, never thrown — it must not be able
    // to take a consolidation cycle down with it.
    return report.ok ? EXIT.ok : EXIT.failed;
  } finally {
    store.close();
  }
}

// ── export ──────────────────────────────────────────────────────────────────

export function exportCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
  observer: boolean,
): number {
  const out = flags["out"];
  if (typeof out !== "string" || out.length === 0) {
    io.err("export needs --out <dir>");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  // AN EXPORT IS A READ, and a store this build cannot open refuses BEFORE the
  // target directory is created — nothing is touched on either side. The
  // sentence is the one every other door prints for the same refusal
  // (`describeDirRefusal` → `describePreRowsRefusal`), never a bare code and a
  // JSON blob (review f5a MINOR-3, f5c NEW-MINOR-3).
  //
  // It opens WRITABLE unless the console has stood down, for one reason: the
  // durable `store.export` row. Until it existed, an export that ran and an
  // export that never had were the same silence — the §2.4 gap the snapshot row
  // closed for the automatic copy. Under `--observer` the copy is still made and
  // the row is not, and the report says which (an instrument does not write to
  // the store it is reading, the durable row included).
  let store: Store;
  try {
    store = openStoreAt({ dir, observer });
  } catch (err) {
    io.err(`export refused: ${describeDirRefusal(err, dir)}`);
    return EXIT.refused;
  }
  try {
    const markdown = flags["markdown"] === true;
    const report = exportStore(store, {
      target: out,
      ...(typeof flags["passphrase"] === "string" ? { passphrase: flags["passphrase"] } : {}),
      ...(flags["plaintext"] === true ? { plaintext: true } : {}),
      ...(markdown ? { markdown: true } : {}),
      ...(flags["include-confidential"] === true ? { includeConfidential: true } : {}),
      ...(flags["with-versions"] === true ? { versions: true } : {}),
      ...(flags["into-non-empty"] === true ? { intoNonEmpty: true } : {}),
      ...(flags["overwrite"] === true ? { overwrite: true } : {}),
    });
    if (!report.ok) {
      io.err(report.reason);
      return EXIT.refused;
    }
    io.out(`Exported ${report.files} files (${report.bytes} bytes) to ${report.target}`);
    io.out(`Kind: ${report.kind}. Mode: ${report.mode}. ${report.reason}`);
    // WHAT THE COPY LEAVES OUT, said in the words retention makes true (remember
    // INTERFACE-GAPS §12, LAUNCH-STATUS §I3): the raw capture is not a memory,
    // no export kind carries it, and a person taking "a copy of my memory"
    // somewhere should not have to discover which half stayed behind.
    io.out(
      "Not included: spans/ — the raw captured conversation, deleted 3 days after a session is written up and ended, and never kept more than 14 days.",
    );
    // THE DURABLE ROW. Counts and flags only: which kind, how many rows went,
    // how many confidential ones were left out, whether it was sealed. NOT the
    // target — where the owner sent his memories is more than the row needs to
    // prove the door works (§5 G10), and the terminal has already said it.
    if (!observer) {
      try {
        store.appendEvent({
          name: STORE_EXPORT_EVENT,
          day: store.livedDay(),
          payload: {
            date: store.today(),
            kind: report.kind,
            encrypted: report.mode === "encrypted",
            files: report.files,
            bytes: report.bytes,
            rows: report.rows,
            omittedConfidential: report.omittedConfidential,
            versions: flags["with-versions"] === true,
            notRendered: report.notRendered.length,
            // The nights, counted apart from `rows` (2026-10-09): the
            // dashboard reads `rows` as memories.
            dreams: report.dreams,
            reflections: report.reflections,
            omittedDreams: report.omittedDreams,
            omittedReflections: report.omittedReflections,
          },
        });
      } catch {
        /* a copy that was made is not undone by a row that could not be written */
      }
    } else {
      io.out(
        "No store.export row was written: this console is in observer stance, and an instrument does not write to the store it is reading.",
      );
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}
