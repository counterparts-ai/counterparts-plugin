/** The commands on what the self holds and dreams: `dream`, `settle`, `about`, `core`, `claims-era`, `self-page` and the night's `catch-up` (moved out of `commands.ts`, 2026-10-11). */
import { existsSync } from "node:fs";
import { localDate } from "../../core/time.js";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Counterpart } from "../../core/counterpart.js";
import { NO_PAGE_VERSION } from "../../core/self/index.js";
import { REFLECTED_FEELING_KEY } from "../../core/sleep/index.js";
import { CLAIMS_ERA_CUTOFF_KEY, storeExists } from "../../core/store/index.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import { CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
import type { ConfigChoice } from "../config-path.js";
import { withBudgetDefault } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { BIN, DEFAULT_STORE_DIR } from "./install.js";
import { bodyFrom, writeLines, versionLines, NO_PAGE_LINES, pageLines } from "./self-page.js";
import { dreamingSettingWords, dreamShowLines, dreamListLines, coreListLines } from "./dream-core.js";
import { settleListLines } from "./settle.js";
import { reoweCommand, catchUpCommand } from "./catch-up.js";
import { DREAMING_SETTINGS, NIGHT_RUN_FINISHES } from "../../core/dream/index.js";
import { EXIT, openCounterpart, openRefusalLine, hostConfigFor } from "./commands-shared.js";
import type { Io, Parsed, RunOptions } from "./commands-shared.js";

/**
 * `dream` — what each dream did, and its undo (2026-09-26). The rules are the
 * core's (`core/dream/`); this picks one of three modes and prints lines
 * (`dream-core.ts`). Reading opens the store as an instrument; `--undo` opens
 * it in the console's stance and the core refuses it under observer.
 */
export function dreamCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const show = parsed.flags["show"];
  const undo = parsed.flags["undo"] === true;
  const undoId = typeof parsed.flags["undo"] === "string" ? parsed.flags["undo"] : parsed.positional[0];
  const setting = parsed.flags["setting"];
  if (typeof show === "string" && undo) {
    io.err("refused: --show and --undo are two different things to do. Pass one.");
    return EXIT.usage;
  }
  if (setting !== undefined) {
    // THE OWNER'S SETTING (2026-09-28): the same value the dream tool's
    // `setting` phase writes ("no dreams" in conversation).
    if (typeof setting !== "string" || !(DREAMING_SETTINGS as readonly string[]).includes(setting)) {
      io.err("refused: --setting takes auto, ask or off.");
      return EXIT.usage;
    }
    if (observer) {
      io.err("refused: this console is an observer; it reads and changes nothing. Nothing was changed.");
      return EXIT.refused;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      const out = counterpart.dreams.setSetting(setting, { by: "owner" });
      if (!out.ok) {
        io.err(`refused: ${out.reason}. Nothing was changed.`);
        return EXIT.refused;
      }
      io.out(`Dreaming: ${out.setting}${out.before === out.setting ? " (it already was)" : ` (was ${out.before})`}.`);
      io.out(`  ${dreamingSettingWords(out.setting)}`);
      // Owner decision D (2026-09-29): "off" does not stop a run already going.
      if (out.setting === "off" && counterpart.dreams.nightRunUnderWay()) io.out(`  ${NIGHT_RUN_FINISHES}`);
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (undo) {
    if (undoId === undefined || undoId.length === 0) {
      io.err("refused: --undo needs the dream's id after it (counterparts dream --list shows them).");
      return EXIT.usage;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      if (counterpart.store.dream(undoId) === undefined) {
        io.err(`refused: no dream ${undoId} in this store. counterparts dream --list shows them.`);
        return EXIT.refused;
      }
      const out = counterpart.dreams.undo(undoId);
      if (!out.ok) {
        io.err(
          out.reason === "observer"
            ? "refused: this console is an observer; it reads and changes nothing. Nothing was undone."
            : `refused: ${out.reason}. Nothing was undone.`,
        );
        return EXIT.refused;
      }
      io.out(
        out.reversed === 0
          ? `Dream ${undoId} had nothing left to reverse; it is marked undone.`
          : `Undid dream ${undoId}: ${String(out.reversed)} ${out.reversed === 1 ? "change" : "changes"} reversed.`,
      );
      io.out("  Merged memories are back as they were, its links and gists are gone, and its replays and nominations were taken back.");
      if (out.kept > 0) {
        io.out(
          `  ${String(out.kept)} ${out.kept === 1 ? "merge was" : "merges were"} left as ${out.kept === 1 ? "it is" : "they are"}: the merged memory has changed since (revised, merged again, or removed), and bringing its originals back would duplicate it.`,
        );
      }
      io.out("  Its journal is kept, marked undone: counterparts dream --show " + undoId);
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  const counterpart = openCounterpart(dir, true);
  try {
    if (typeof show === "string") {
      const lines = dreamShowLines(counterpart, show);
      if (lines === null) {
        io.err(`refused: no dream ${show} in this store. counterparts dream --list shows them.`);
        return EXIT.refused;
      }
      for (const line of lines) io.out(line);
      return EXIT.ok;
    }
    for (const line of dreamListLines(counterpart, parsed.flags["all"] === true ? "all" : undefined)) io.out(line);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * `settle` — contradictions, the owner's door (2026-09-29). The list reads
 * under any stance; a settle and an undo go through `Counterpart
 * .settleContradiction` / `.undoContradiction`, which decide everything and
 * refuse under observer. The owner is the actor on the trail.
 */
export function settleCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const str = (name: string): string | undefined => {
    const v = parsed.flags[name];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  };
  const undo = parsed.flags["undo"] === true;
  const how = str("how");
  const writing = undo || how !== undefined || str("pair") !== undefined || str("holds") !== undefined || str("against") !== undefined;
  if (undo && how !== undefined) {
    io.err("refused: --undo and --how are two different things to do. Pass one.");
    return EXIT.usage;
  }
  if (!writing) {
    const counterpart = openCounterpart(dir, true);
    try {
      for (const line of settleListLines(counterpart)) io.out(line);
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (observer) {
    io.err("refused: this console is an observer; it reads and changes nothing. Nothing was settled.");
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir, observer);
  try {
    if (undo) {
      const id = parsed.positional[0];
      if (id === undefined || id.length === 0) {
        io.err("refused: --undo needs the pair's id after it (counterparts settle lists them).");
        return EXIT.usage;
      }
      const out = counterpart.undoContradiction({ pair: id, actor: "owner", why: str("why") ?? null });
      if (!out.ok) {
        io.err(`refused: ${out.reason} — ${out.detail} Nothing was undone.`);
        return EXIT.refused;
      }
      io.out(
        out.state === "unsettled"
          ? `Undid the settle of ${out.pair} (${out.how ?? "settled"}); the pair is unsettled again — a question to settle.`
          : `Undid the settle of ${out.pair} (${out.how ?? "settled"}); the pair is withdrawn — nobody had flagged it, so nothing is left to settle.`,
      );
      if (out.restored !== null) io.out(`  ${out.restored}'s strength is back to what it was.`);
      if (out.unarchived !== null) io.out(`  ${out.unarchived} is back in recall.`);
      if (out.reopened.length > 0) io.out(`  Reopened too: ${out.reopened.join(", ")}.`);
      if (out.note !== undefined) io.out(`  ${out.note}`);
      return EXIT.ok;
    }
    if (how === undefined) {
      io.err("refused: say how it settles: --how changed, corrected or open.");
      return EXIT.usage;
    }
    const pair = str("pair");
    const holds = str("holds");
    const over = str("against");
    const out = counterpart.settleContradiction({
      ...(pair === undefined ? {} : { pair }),
      ...(holds === undefined ? {} : { holds }),
      ...(over === undefined ? {} : { over }),
      how,
      why: str("why") ?? null,
      actor: "owner",
    });
    if (!out.ok) {
      io.err(`refused: ${out.reason} — ${out.detail} Nothing was settled.`);
      return EXIT.refused;
    }
    io.out(
      out.how === "open"
        ? `Settled ${out.pair}: open — both memories stay, each shown with the other.`
        : `Settled ${out.pair}: ${out.how} — ${String(out.holds)} holds over ${String(out.over)}.`,
    );
    if (out.faded !== null) io.out(`  ${out.faded.id} fades once (strength ${String(out.faded.before)} → ${String(out.faded.after)}) and is shown as earlier; use can hold it.`);
    if (out.archived !== null) io.out(`  ${out.archived} leaves recall; it stays readable by its id (counterparts ask --id ${out.archived}).`);
    if (out.note !== undefined) io.out(`  ${out.note}`);
    io.out(`  Undo: counterparts settle --undo ${out.pair}`);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/** Who set a mark, in the words `about` prints. */
const ABOUT_BY_WORDS: Record<string, string> = {
  writer: "the writer, when it was written",
  reflection: "a nightly reflection",
  owner: "you",
  upgrade: "the v9 upgrade, by its kind",
  self: "me, awake in a session",
};

/**
 * `about` — what a memory is about, and the owner's door to change it
 * (2026-10-11, the about-marks lane). With an id alone it reads; with a mark
 * it goes through `Counterpart.markAbout` as the owner, which decides
 * everything and refuses under observer. The dashboard's "about" action runs
 * this same command.
 */
export function aboutCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const [id, mark, ...rest] = parsed.positional;
  const why = typeof parsed.flags["why"] === "string" ? parsed.flags["why"].trim() : "";
  if (id === undefined || id.trim().length === 0) {
    io.err('refused: name a memory: counterparts about <id> [me|us|owner|work|world] [--why "..."].');
    return EXIT.usage;
  }
  if (rest.length > 0) {
    io.err(`refused: one id and one mark — "${rest.join(" ")}" is more. Put a reason in --why "...".`);
    return EXIT.usage;
  }
  if (mark === undefined) {
    if (why.length > 0) {
      io.err("refused: --why goes with a mark. Pass one, or leave it out.");
      return EXIT.usage;
    }
    const counterpart = openCounterpart(dir, true);
    try {
      // An earlier version reads as the current one, as the write marks it.
      let head = id;
      try {
        head = counterpart.store.resolve(id);
      } catch {
        /* unknown: refused below */
      }
      const row = counterpart.store.row(head);
      if (row === undefined || row.type !== "memory") {
        io.err(`refused: no memory ${id} in this store. Nothing was read.`);
        return EXIT.refused;
      }
      io.out(
        row.about === null
          ? `${head} is unmarked.`
          : `${head} is about ${row.about} — marked by ${ABOUT_BY_WORDS[row.about_by ?? ""] ?? row.about_by ?? "someone unrecorded"}.`,
      );
      if (head !== id) io.out(`  ${id} is an earlier version; this is the current one.`);
      io.out(`  Change it: counterparts about ${head} me|us|owner|work|world --why "..."`);
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (observer) {
    io.err("refused: this console is an observer; it reads and changes nothing. Nothing was marked.");
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir, observer);
  try {
    const out = counterpart.markAbout({ id, mark, by: "owner", why: why.length > 0 ? why : null });
    if (!out.ok) {
      io.err(`refused: ${out.detail} Nothing was marked.`);
      return EXIT.refused;
    }
    const was = out.before === null ? "unmarked" : out.before;
    io.out(
      out.changed
        ? `Marked ${out.id} about ${out.mark} (it was ${was}), as you.`
        : `${out.id} was already about ${out.mark}; it is recorded as yours now.`,
    );
    if (out.forwardedFrom !== undefined) io.out(`  ${out.forwardedFrom} is an earlier version; the current one, ${out.id}, carries the mark.`);
    if (out.why !== null) io.out(`  Why, as recorded: ${out.why}`);
    if (out.note !== undefined) io.out(`  ${out.note}`);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * `core` — what the core holds, and the owner's door out of it (2026-09-26).
 * `--demote` opens the store in the console's stance; `Counterpart.demoteCore`
 * decides everything and refuses under observer.
 */
export function coreCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const demote = parsed.flags["demote"];
  const keep = parsed.flags["reaffirm"];
  const reason = parsed.flags["reason"];
  const reflected = parsed.flags["reflected-feeling"];
  if (reflected !== undefined) {
    if (reflected !== "on" && reflected !== "off") {
      io.err("refused: --reflected-feeling takes on or off.");
      return EXIT.usage;
    }
    if (observer) {
      io.err("refused: this console is an observer; it reads and changes nothing. Nothing was changed.");
      return EXIT.refused;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      counterpart.store.setMeta(REFLECTED_FEELING_KEY, reflected);
      io.out(
        reflected === "on"
          ? "On: a feeling a reflection records later and a reflection citing a memory both count toward the fast lane, and a reflection may re-label what a memory is about either way — each re-label is recorded with its reason, and one into me, us or the owner is told in the next morning share."
          : "Off: nothing reaches the core on a reflection alone — the fast lane needs a feeling felt at the time (not one a reflection recorded later) and an ordinary use after a gap (not a reflection citing it), and a reflection may only move what a memory is about toward work or world.",
      );
      io.out("  It takes effect at the next consolidation. Nothing already in the core moves.");
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (typeof demote === "string" && typeof keep === "string") {
    io.err("refused: --demote or --reaffirm, not both.");
    return EXIT.usage;
  }
  if (reason !== undefined && typeof demote !== "string" && typeof keep !== "string") {
    io.err("refused: --reason goes with a --demote or a --reaffirm. Pass one, or leave it out.");
    return EXIT.usage;
  }
  // KEEP (2026-10-11, Group 3 part A): the owner's answer to "being reconsidered".
  if (typeof keep === "string") {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      io.err('refused: keeping one needs a reason — --reason "why" — and it is kept with the record.');
      return EXIT.usage;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      const out = counterpart.keepCore(keep, { why: reason, actor: "owner" });
      if (!out.ok) {
        const why: Record<string, string> = {
          observer: "this console is an observer; it reads and changes nothing",
          "unknown-id": `no memory ${keep} in this store`,
          "not-core": `${keep} is not in the core (counterparts core --list shows what is)`,
          "reason-required": "keeping one needs a reason",
        };
        io.err(`refused: ${why[out.reason] ?? out.reason}. Nothing was changed.`);
        return EXIT.refused;
      }
      io.out(`Kept ${keep} in the core.`);
      io.out(`  Why, as recorded: ${reason.trim()}`);
      io.out("  It is no longer being reconsidered, and it is not flagged again for what it is — only if it stops coming back.");
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (typeof demote === "string") {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      io.err('refused: a demotion needs a reason — --reason "why" — and it is kept with the record.');
      return EXIT.usage;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      const out = counterpart.demoteCore(demote, { reason, actor: "owner" });
      if (!out.ok) {
        const why: Record<string, string> = {
          observer: "this console is an observer; it reads and changes nothing",
          "unknown-id": `no memory ${demote} in this store`,
          "not-core": `${demote} is not in the core (counterparts core --list shows what is)`,
          "reason-required": "a demotion needs a reason",
        };
        io.err(`refused: ${why[out.reason] ?? out.reason}. Nothing was changed.`);
        return EXIT.refused;
      }
      io.out(`Sent ${demote} back to ordinary fading, from today.`);
      io.out(`  Why, as recorded: ${reason.trim()}`);
      io.out("  It fades like any other memory now, and the core's lanes will not promote it again.");
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  const counterpart = openCounterpart(dir, true);
  try {
    for (const line of coreListLines(counterpart)) io.out(line);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * `claims-era` — the old-claims era's switch (2026-10-10; decided by Mike,
 * 2026-10-10, loosely held). With no flags it reads; `--off` deletes the
 * cutoff the curve reads (`store/operational.ts#CLAIMS_ERA_CUTOFF_KEY`), so
 * every claim reads as stored again — old explicit claims read down and old
 * defaults read up or down alike (2026-10-11); `--on` puts back the cutoff
 * first recorded. The READING is what toggles: a memory the floor prune archived
 * while the era was on stays archived (no door un-archives a `pruned` row).
 * Either takes effect at the next nightly pass (the curve's signature carries
 * the cutoff, so every next-change day is recomputed once).
 */
export function claimsEraCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const on = parsed.flags["on"] === true;
  const off = parsed.flags["off"] === true;
  if (on && off) {
    io.err("refused: --on and --off are two different things to do. Pass one.");
    return EXIT.usage;
  }
  if ((on || off) && observer) {
    io.err("refused: this console is an observer; it reads and changes nothing. Nothing was changed.");
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir, observer || (!on && !off));
  try {
    const store = counterpart.store;
    const day = (ms: number): string => localDate(ms, store.zone());
    if (off) {
      store.updateMeta(CLAIMS_ERA_CUTOFF_KEY, () => null);
      io.out("Off: every claim reads as stored again. No claim was rewritten, so the reading comes back exactly.");
      io.out("  A memory let go at the floor while it was on stays archived (readable by id); turning it off does not bring it back.");
      io.out("  It takes effect at the next nightly pass. `counterparts claims-era --on` puts it back.");
      return EXIT.ok;
    }
    if (on) {
      const recorded = store.claimsEra().recorded;
      if (recorded === null) {
        io.err("refused: this store has no recorded cutoff yet; a writable open records it. Nothing was changed.");
        return EXIT.refused;
      }
      store.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(recorded));
      const era = store.claimsEra();
      io.out(
        `On: memories written before ${day(recorded)} are read at today's default for what they are about — ${String(era.affected)} ${era.affected === 1 ? "memory" : "memories"} now${eraSplit(era)}.`,
      );
      io.out("  It takes effect at the next nightly pass. `counterparts claims-era --off` reads every claim as stored again.");
      return EXIT.ok;
    }
    const era = store.claimsEra();
    if (era.cutoff === null) {
      io.out(
        era.recorded === null
          ? "Off: no cutoff recorded yet (a writable open records one). Every claim reads as stored."
          : `Off: every claim reads as stored. \`counterparts claims-era --on\` reads the ones written before ${day(era.recorded)} at today's default again.`,
      );
      return EXIT.ok;
    }
    io.out(
      `On since ${day(era.cutoff)}: ${String(era.affected)} ${era.affected === 1 ? "memory" : "memories"} written before it ${era.affected === 1 ? "is" : "are"} read at today's default for what ${era.affected === 1 ? "it is" : "they are"} about${eraSplit(era)}. No claim was rewritten.`,
    );
    io.out("  Lower: a claim made under the old text, or an old default above today's. Higher: an old default below today's.");
    io.out("  An explicit claim is kept as claimed for the core, memories about the owner or us, said by the owner, protected, and dated ones still ahead or repeating, and wherever it is already at or below the default.");
    io.out("  `counterparts claims-era --off` reads every claim as stored again.");
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/** The era's two directions, in a clause (2026-10-11): empty when it reads none. */
function eraSplit(era: { affected: number; down: number; up: number }): string {
  return era.affected === 0 ? "" : ` (${String(era.down)} lower than stored, ${String(era.up)} higher)`;
}

/**
 * `self-page` — the owner's door to the written page (2026-09-18, S1).
 *
 * Four modes on one command, and they are the four questions the owner has:
 * what does it say, what did it used to say, what did version N say, and
 * replace it. Every rule about the write is the core seam's
 * (`self/#revisePage`); this decides nothing but which of the four ran.
 *
 * The store is opened in the CONSOLE's stance rather than always as an
 * observer, because `--write` is a real write. A read under observer works, and
 * a `--write` under observer refuses at the seam, which is where every other
 * write refuses (see the note on `OWNER_OPS`).
 */
export async function selfPageCommand(
  dir: string,
  io: Io,
  parsed: Parsed,
  observer: boolean,
  namedDir: boolean,
  stdin?: RunOptions["stdin"],
): Promise<number> {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const write = parsed.flags["write"] === true;
  const clear = parsed.flags["clear"] === true;
  const restore = parsed.flags["restore"];
  const wantsVersions = parsed.flags["versions"] === true;
  const seq = parsed.flags["version"];
  // ONE MODE PER INVOCATION. Three of these change the page and two read it;
  // a line that names two of them means something the console would have to
  // guess at, and the store it would guess against is the owner's memory.
  const modes = [write, clear, typeof restore === "string", wantsVersions, typeof seq === "string"];
  if (modes.filter(Boolean).length > 1) {
    io.err(
      "refused: --write, --clear, --restore, --versions and --version are five different things to do. Pass one.",
    );
    return EXIT.usage;
  }
  const ifVersionFlag = parsed.flags["if-version"];
  if (ifVersionFlag !== undefined && !write) {
    io.err("refused: --if-version guards a --write. Pass it with one, or leave it out.");
    return EXIT.usage;
  }
  let ifVersion: number | undefined;
  if (typeof ifVersionFlag === "string") {
    // `none` is the value that says "I read no page", so the guard can be used
    // on a first write as well as an amendment.
    ifVersion = ifVersionFlag.trim().toLowerCase() === "none" ? NO_PAGE_VERSION : Number(ifVersionFlag);
    if (!Number.isInteger(ifVersion) || ifVersion < NO_PAGE_VERSION) {
      io.err(
        `refused: --if-version takes the version number a read printed, or 'none' for a page that was not there, not '${ifVersionFlag}'.`,
      );
      return EXIT.usage;
    }
  }

  // THE SHORT VERSION (2026-10-10): a file, read before the store opens like
  // the page. With --file or --stdin it goes beside the page; alone, it is
  // added to the page as it stands.
  const shortFlag = parsed.flags["short"];
  if (shortFlag !== undefined && (!write || typeof shortFlag !== "string")) {
    io.err("refused: --short <file> is the page's short version, and goes with --write.");
    return EXIT.usage;
  }
  let short: string | null = null;
  if (typeof shortFlag === "string") {
    const read = bodyFrom({ file: shortFlag }, () => "");
    if ("error" in read) {
      io.err(`refused: ${read.error}`);
      return read.missing === true ? EXIT.usage : EXIT.failed;
    }
    short = read.body;
  }
  const shortAlone = short !== null && parsed.flags["file"] === undefined && parsed.flags["stdin"] === undefined;

  // THE PAGE IS READ FROM STDIN BEFORE THE STORE OPENS, so a pipe that never
  // closes cannot leave a store open behind it.
  let body: string | null = null;
  if (write && !shortAlone) {
    const from = parsed.flags["file"];
    const wantsStdin = parsed.flags["stdin"] === true;
    if (typeof from === "string" && wantsStdin) {
      io.err("refused: --file and --stdin both name where the page comes from; pass one.");
      return EXIT.usage;
    }
    if (typeof from !== "string" && !wantsStdin) {
      io.err("refused: --write needs the page: --file <path>, or --stdin.");
      return EXIT.usage;
    }
    if (typeof from === "string") {
      const read = bodyFrom({ file: from }, () => "");
      if ("error" in read) {
        io.err(`refused: ${read.error}`);
        // A missing file is a command line that is wrong; one that is there and
        // will not open is the machine failing, and `EXIT.failed` exists for it.
        return read.missing === true ? EXIT.usage : EXIT.failed;
      }
      body = read.body;
    } else {
      if (stdin === undefined) {
        io.err("refused: this console has no standard input to read the page from.");
        return EXIT.usage;
      }
      if (stdin.isTty) {
        io.err(
          "refused: stdin is a terminal. Pipe the page in (cat page.md | counterparts self-page --write --stdin), or use --file <path>.",
        );
        return EXIT.usage;
      }
      body = await stdin.read();
    }
  }

  let counterpart: Counterpart;
  try {
    counterpart = openCounterpart(dir, observer);
  } catch (err) {
    io.err(openRefusalLine(err, dir));
    return EXIT.failed;
  }
  try {
    const cap = counterpart.self.tunables.PAGE_MAX_BYTES;
    const room = counterpart.self.tunables.PAGE_ROOM_BYTES;
    const say = (out: ReturnType<typeof writeLines>): number => {
      for (const line of out.lines) (out.ok ? io.out : io.err)(line);
      return out.ok ? EXIT.ok : EXIT.refused;
    };
    const reason = parsed.flags["reason"];
    const why = (fallback: string): string =>
      typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : fallback;

    if (write && shortAlone) {
      if (counterpart.selfPage() === null) {
        io.err("refused: there is no page to add a short version to. Write the page first (--write --file <path>), with --short beside it.");
        return EXIT.refused;
      }
      return say(
        writeLines(
          counterpart.addPageShort(short ?? "", {
            reason: why("owner added a short version"),
            by: "owner",
            ...(ifVersion === undefined ? {} : { ifVersion }),
          }),
          cap,
          room,
        ),
      );
    }
    if (write) {
      return say(
        writeLines(
          counterpart.revisePage(body ?? "", {
            reason: why("owner edit"),
            by: "owner",
            ...(ifVersion === undefined ? {} : { ifVersion }),
            ...(short === null ? {} : { short }),
          }),
          cap,
          room,
        ),
      );
    }
    if (clear) {
      // The door removal was standing in for. Nothing is destroyed: the body
      // becomes a version, the row stays live with a cleared marker, and the
      // store reads as having no page from the next call on.
      return say(writeLines(counterpart.clearPage({ reason: why("owner cleared the page") }), cap));
    }
    if (typeof restore === "string") {
      const want = Number(restore);
      if (!Number.isInteger(want) || want < 1) {
        io.err(`refused: --restore takes a version seq from 'self-page --versions', not '${restore}'.`);
        return EXIT.usage;
      }
      if (!counterpart.selfPageVersions({ bodies: false }).some((v) => v.seq === want)) {
        io.err(`refused: no version ${want}. 'self-page --versions' lists the ones there are.`);
        return EXIT.usage;
      }
      return say(writeLines(counterpart.restorePage(want, { reason: why(`restored version ${want}`) }), cap));
    }
    if (wantsVersions) {
      for (const line of versionLines(counterpart.selfPageVersions())) io.out(line);
      return EXIT.ok;
    }
    if (typeof seq === "string") {
      const want = Number(seq);
      const found = counterpart.selfPageVersions().find((v) => v.seq === want);
      if (found === undefined) {
        io.err(`refused: no version ${seq}. 'self-page --versions' lists the ones there are.`);
        return EXIT.usage;
      }
      // The header goes to STDERR, so `self-page --version 1 > file` writes the
      // page and nothing else. The owner had to hand-edit it out before, which
      // is half of why `--restore` exists.
      io.err(
        `version ${found.seq} — lived day ${found.day}, ${found.by === null ? "" : `${found.by}: `}${found.reason ?? "(reason unrecorded)"}`,
      );
      for (const line of (found.body ?? "(this version's prose could not be read)").split("\n")) io.out(line);
      return EXIT.ok;
    }
    const page = counterpart.selfPage();
    if (page === null) {
      for (const line of NO_PAGE_LINES) io.out(line);
      return EXIT.ok;
    }
    // COUNTED, not read (m9): printing one number used to read every archived
    // body off disk.
    const lines = pageLines(page, counterpart.self.pageStale(page), counterpart.selfPageVersionCount());
    for (const line of lines) io.out(line);
    return EXIT.ok;
  } finally {
    counterpart.store.close();
  }
}

/** `catch-up`: which store and which configuration, then the run (`catch-up.ts`). */
export async function catchUpEntry(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  const home_ = opts.home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
  let config: AdapterConfig;
  let fromFile: string | undefined;
  if (typeof parsed.flags["dir"] === "string") {
    // `--dir` IS A NAME: the store alone, no configuration read beside it.
    config = { dataDir: resolve(parsed.flags["dir"]) };
  } else {
    if (!existsSync(configPath)) {
      io.err(
        `refused: there is no configuration at ${configPath}, so there is no store here to catch up. ` +
          `Run '${BIN.cli} install' first, name the configuration with ${CONFIG_FLAG} <absolute path>, or name a store with --dir <path>.`,
      );
      return EXIT.refused;
    }
    const host = hostConfigFor(configPath);
    if (host.reason === "unreadable") {
      io.err(`refused: ${configPath} is there and will not be understood, so this will not guess which store to write into. --dir <path> names one directly.`);
      return EXIT.refused;
    }
    // The hooks' ceiling default (`config.ts#withBudgetDefault`): the run
    // renders the wake under the ceiling a session start reads it at.
    config = withBudgetDefault({ ...host.config, dataDir: host.config.dataDir ?? join(dirname(configPath), DEFAULT_STORE_DIR) });
    fromFile = configPath;
  }
  const dataDir = config.dataDir ?? "";
  if (dataDir.length === 0 || !storeExists(dataDir)) {
    io.err(`no store at ${dataDir}. Run '${BIN.cli} install' first, or name another store with --dir.`);
    return EXIT.failed;
  }
  if (config.observer === true) {
    io.err("refused: this configuration is an observer's, and a catch-up writes memories.");
    return EXIT.refused;
  }
  // `--dry-run` and `--yes` belong to `--reowe` (review of #435): alone, a
  // typed `catch-up --dry-run` would start a real run that writes memories.
  if (parsed.flags["reowe"] === undefined && (parsed.flags["dry-run"] !== undefined || parsed.flags["yes"] !== undefined)) {
    io.err(`usage: --dry-run and --yes go with --reowe <run>. ${BIN.cli} catch-up alone starts a real run; it has no dry run.`);
    return EXIT.usage;
  }
  if (parsed.flags["reowe"] !== undefined) {
    return await reoweCommand({ config: { ...config, dataDir }, io, now, run: parsed.flags["reowe"], dryRun: parsed.flags["dry-run"] === true, yes: parsed.flags["yes"] === true });
  }
  return await catchUpCommand({
    config: { ...config, dataDir },
    ...(fromFile === undefined ? {} : { configPath: fromFile }),
    env,
    out: (l) => io.out(l),
    err: (l) => io.err(l),
    now,
    ...(opts.catchUpStart === undefined ? {} : { start: opts.catchUpStart }),
  });
}
