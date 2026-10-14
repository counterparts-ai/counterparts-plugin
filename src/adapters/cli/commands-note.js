import { join } from "node:path";
import { STORE_EXPORT_EVENT } from "../../core/counterpart.js";
import { readChapterLead, readableDate } from "../../core/self/index.js";
import { Store, storeExists } from "../../core/store/index.js";
import { deliberateRecall, embedQuestion } from "../mcp/deliberate.js";
import { factsRecall, renderFacts } from "../mcp/facts.js";
import { meaningRecall, renderMeaning } from "../mcp/meaning.js";
import { CONFIG_FLAG, implicitConfigRefusal, resolveConfigPath } from "../config-path.js";
import { withEmbedderDefault } from "../config.js";
import { openEmbedder } from "../claude-code/embed-client.js";
import { exportStore } from "./export.js";
import { BIN } from "./install.js";
import { paint } from "./ui.js";
import { snapshotName, snapshot } from "./snapshot.js";
import { feelingsLine } from "../feelings-line.js";
import {
  EXIT,
  openCounterpart,
  hostConfigFor,
  openStoreAt,
  openRefusalLine,
  describeDirRefusal
} from "./commands-shared.js";
export async function noteCommand(dir, io, parsed, env, home, filedUnder) {
  const text = parsed.positional.join(" ").trim();
  if (text.length === 0) {
    io.err('refused: note takes the text to remember, e.g. counterparts note "..."');
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}. Run 'counterparts install' first.`);
    return EXIT.failed;
  }
  let claimed;
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
    io.out(`Store: ${counterpart.store.dir}`);
    const session = "console";
    const scope = filedUnder ?? process.cwd();
    const captured = counterpart.captureJot({ session, scope, text });
    const ownSpanHash = captured.spans[0]?.hash ?? null;
    const draft = { content: text };
    if (typeof parsed.flags["kind"] === "string")
      draft["kind"] = parsed.flags["kind"];
    if (typeof parsed.flags["title"] === "string")
      draft["title"] = parsed.flags["title"];
    if (claimed !== undefined)
      draft["claimed"] = claimed;
    const deposit = await counterpart.submitJot(draft, {
      session,
      scope,
      ...ownSpanHash === null ? {} : { ownSpanHash }
    });
    if (!deposit.deposited) {
      io.err(`not stored: ${deposit.reason}${deposit.gate === null ? "" : ` (${deposit.gate})`}`);
      return EXIT.refused;
    }
    io.out(`Remembered ${deposit.memoryId ?? "(no id)"} — ${deposit.reason}.`);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}
export function askEmbedder(flags, env, home) {
  const choice = resolveConfigPath(typeof flags["config"] === "string" ? [`${CONFIG_FLAG}=${flags["config"]}`] : [], env, home);
  const readable = choice.refusal === null && implicitConfigRefusal(choice, env) === null;
  const config = withEmbedderDefault(readable ? hostConfigFor(choice.path).config : {});
  return openEmbedder(config, { env });
}
export const ASK_SHOWN = 5;
export const ASK_GIST_CHARS = 90;
function plainLine(text) {
  return text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "").replace(/\s+/g, " ").trim();
}
export function askGist(title, body) {
  const titled = title === null ? "" : plainLine(readChapterLead(title).rest);
  const words = titled.length > 0 ? titled : plainLine(readChapterLead(body).rest);
  const said = words.length > 0 ? words : plainLine(title ?? body);
  return said.length <= ASK_GIST_CHARS ? said : `${said.slice(0, ASK_GIST_CHARS).trimEnd()}…`;
}
export function askMeta(m, learnedOn) {
  const lead = readChapterLead(m.body);
  const parts = [m.journal ? "journal" : m.kind];
  const [lo, hi] = [lead.chapters[0], lead.chapters[lead.chapters.length - 1]];
  if (lo !== undefined && hi !== undefined) {
    parts.push(lo === hi ? `chapter ${String(lo)}` : `chapters ${String(lo)}–${String(hi)}`);
  }
  const date = lead.date ?? (learnedOn === null ? "" : readableDate(learnedOn));
  if (date.length > 0)
    parts.push(date);
  if (lead.model !== null)
    parts.push(lead.model);
  if (lead.livedDay !== null)
    parts.push(`lived day ${String(lead.livedDay)}`);
  parts.push(m.id);
  return parts.join(" · ");
}
function askChannel(semantic, verdict, embedder) {
  if (verdict === "held" || verdict === "cache-ahead" || verdict === "deferred") {
    return "by words only — this store's meaning index is on hold; see counterparts doctor";
  }
  if (semantic === "in-line")
    return "by meaning and words";
  if (semantic === "embedder-off")
    return "by words only — recall by meaning is off";
  if (embedder?.unavailable === "NO_WEIGHTS")
    return "by words only — the meaning table is not installed";
  if (embedder?.unavailable !== undefined)
    return "by words only — the meaning table could not be loaded";
  return "by words only — the question could not be embedded";
}
export async function recallCommand(dir, io, parsed, env, home) {
  const said = parsed.command === "recall" ? "recall" : "ask";
  const idFlag = typeof parsed.flags["id"] === "string" ? parsed.flags["id"].trim() : "";
  const question = parsed.positional.join(" ").trim();
  if (idFlag.length === 0 && question.length === 0) {
    io.err(`refused: ${said} takes a question, e.g. ${BIN.cli} ${said} "..." — or --id <id>.`);
    return EXIT.usage;
  }
  if (idFlag.length > 0 && question.length > 0) {
    io.err("refused: a question and --id are two different asks. Send one.");
    return EXIT.usage;
  }
  const modeFlag = parsed.flags["mode"];
  if (modeFlag !== undefined && modeFlag !== "facts" && modeFlag !== "meaning") {
    io.err(`refused: --mode is facts or meaning, not ${typeof modeFlag === "string" ? JSON.stringify(modeFlag) : "empty"}.`);
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}. Run 'counterparts install' first.`);
    return EXIT.failed;
  }
  const embedder = question.length > 0 ? askEmbedder(parsed.flags, env, home) : null;
  const counterpart = openCounterpart(dir, true, undefined, embedder?.embed);
  try {
    if (parsed.flags["json"] !== true)
      io.out(`Store: ${counterpart.store.dir}`);
    if (idFlag.length === 0) {
      const embedded = await embedQuestion(embedder, question);
      const page = typeof parsed.flags["page"] === "string" && /^[1-9]\d*$/.test(parsed.flags["page"]) ? { page: Number(parsed.flags["page"]) } : {};
      if (modeFlag === "meaning") {
        const meaning = meaningRecall({
          counterpart,
          sessionId: "console",
          owner: true,
          vector: embedded.vector,
          semantic: embedded.semantic,
          asker: parsed.flags["voiced"] === true ? "self" : "owner"
        }, question, page);
        io.out(parsed.flags["json"] === true ? JSON.stringify(meaning, null, 2) : renderMeaning(meaning));
        return EXIT.ok;
      }
      const facts = factsRecall({ counterpart, sessionId: "console", owner: true, vector: embedded.vector, semantic: embedded.semantic }, question, page);
      if (parsed.flags["json"] === true) {
        io.out(JSON.stringify(facts, null, 2));
        return EXIT.ok;
      }
      if (parsed.flags["full"] === true) {
        io.out(renderFacts(facts));
        return EXIT.ok;
      }
      printAskList(io, facts, askChannel(facts.semantic, counterpart.store.embedderVerdict.kind, embedder), said, {
        learnedOn: (id) => facts.memories.find((m) => m.id === id)?.learned ?? null,
        dim: paint(io, env).dim
      });
      return EXIT.ok;
    }
    const result = deliberateRecall(counterpart, { handle: idFlag }, { sessionId: "console", owner: true });
    if (parsed.flags["json"] === true) {
      io.out(JSON.stringify(result, null, 2));
      return EXIT.ok;
    }
    io.out(`${result.path} · ${result.reason} · ` + `${result.storeSize} live rows · returned ${result.memories.length}`);
    if (result.memories.length === 0) {
      io.out("");
      io.out(`NOTHING CAME BACK — no memory has that id or that exact title.`);
      io.out(`  Ask a question instead: ${BIN.cli} ${said} "..."`);
      return EXIT.ok;
    }
    for (const m of result.memories) {
      io.out("");
      const journal = m.journal ? "[journal] " : "";
      io.out(`  ${m.id}  ${journal}${m.kind}${m.title === null ? "" : ` — ${m.title}`}`);
      if (m.standing !== undefined)
        io.out(`    (${m.standing})`);
      for (const line of m.body.split(`
`))
        io.out(`    ${line}`);
      let felt = "";
      try {
        const born = counterpart.store.physicsOf(m.id).birthDay;
        felt = feelingsLine(counterpart.store.feelingsFor(m.id), counterpart.store.livedDay() - born);
      } catch {
        felt = "";
      }
      if (felt !== "")
        io.out(`    feelings — ${felt}`);
    }
    if (result.memories.some((m) => m.journal)) {
      io.out("");
      io.out("  journal = a chapter, the first-person account a memory was made from — not a memory, and outside decay and the prune.");
    }
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}
export function printAskList(io, result, how, said, opts = {}) {
  const found = Math.max(result.matched ?? 0, result.memories.length);
  if (found === 0) {
    io.out(`Nothing found (${how}).`);
    io.out(result.considered === 0 ? "  Nothing in the store came near the question, so no memory was even scored." : `  ${result.considered} ${result.considered === 1 ? "memory was" : "memories were"} weighed and none was close enough to show.`);
    io.out(`  Try words the memory itself would use, or ask for it by id: ${BIN.cli} ${said} --id <mem_...>`);
    return;
  }
  const shown = result.memories.slice(0, ASK_SHOWN);
  const counted = `${String(found)} ${found === 1 ? "memory" : "memories"} found, ${how}.`;
  io.out(found > ASK_SHOWN ? `${counted} The top ${String(ASK_SHOWN)}:` : counted);
  const dim = opts.dim ?? ((s) => s);
  const numberWidth = String(shown.length).length;
  shown.forEach((m, i) => {
    const mark = `  ${String(i + 1).padStart(numberWidth)}. `;
    io.out("");
    io.out(`${mark}${askGist(m.title, m.body)}`);
    io.out(`${" ".repeat(mark.length)}${dim(`${askMeta(m, opts.learnedOn?.(m.id) ?? null)}${m.faded === true ? " · faded" : ""}`)}`);
  });
  io.out("");
  io.out(found > ASK_SHOWN ? "More: --full for all of them with detail, or --id <id> for one in full." : "More: --full for detail, or --id <id> for one in full.");
}
export function backupCommand(dir, io, out, now) {
  if (typeof out !== "string" || out.length === 0) {
    io.err("backup needs --out <dir>");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  let store;
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
    for (const entry of report.excluded)
      io.out(`  --   ${entry.name}  — ${entry.why}`);
    for (const error of report.errors)
      io.err(`  ${error}`);
    return report.ok ? EXIT.ok : EXIT.failed;
  } finally {
    store.close();
  }
}
export function exportCommand(dir, io, flags, observer) {
  const out = flags["out"];
  if (typeof out !== "string" || out.length === 0) {
    io.err("export needs --out <dir>");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  let store;
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
      ...typeof flags["passphrase"] === "string" ? { passphrase: flags["passphrase"] } : {},
      ...flags["plaintext"] === true ? { plaintext: true } : {},
      ...markdown ? { markdown: true } : {},
      ...flags["include-confidential"] === true ? { includeConfidential: true } : {},
      ...flags["with-versions"] === true ? { versions: true } : {},
      ...flags["into-non-empty"] === true ? { intoNonEmpty: true } : {},
      ...flags["overwrite"] === true ? { overwrite: true } : {}
    });
    if (!report.ok) {
      io.err(report.reason);
      return EXIT.refused;
    }
    io.out(`Exported ${report.files} files (${report.bytes} bytes) to ${report.target}`);
    io.out(`Kind: ${report.kind}. Mode: ${report.mode}. ${report.reason}`);
    io.out("Not included: spans/ — the raw captured conversation, deleted 3 days after a session is written up and ended, and never kept more than 14 days.");
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
            dreams: report.dreams,
            reflections: report.reflections,
            omittedDreams: report.omittedDreams,
            omittedReflections: report.omittedReflections
          }
        });
      } catch {}
    } else {
      io.out("No store.export row was written: this console is in observer stance, and an instrument does not write to the store it is reading.");
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}
