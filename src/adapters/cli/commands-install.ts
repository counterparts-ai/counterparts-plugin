/** `install` (its conversation and Claude Desktop's entry), `connect` / `disconnect`, and `init` (moved out of `commands.ts`, 2026-10-11). */
import { existsSync, readFileSync } from "node:fs";
import { resolveZone } from "../../core/time.js";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PAGE_HOST_BUDGET_BYTES } from "../../core/self/index.js";
import { Store, isWithin, storeExists } from "../../core/store/index.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import { CONFIG_ENV, CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
import type { ConfigChoice } from "../config-path.js";
// The local table's locator, for install's one check that the weights the new
// configuration asks for are where the hooks will look.
import {
  MODEL_FILE,
  STATIC_WEIGHTS_ENV,
  STATIC_WEIGHTS_PACKAGE,
  resolveStaticWeights,
} from "../../core/embed/static.js";
import {
  installLayout,
  layoutRefusal,
  throwawayDefaultRefusal,
  parkedSiblings,
  BIN,
  budgetRefusal,
  resolveEmbedderBlock,
  configObject,
  writeOnce,
  settingsBlock,
  hookCommand,
  mcpCommand,
  hostSettingsDir,
  bringParkedBack,
  DEFAULT_STORE_DIR,
} from "./install.js";
import type { InstallLayout, ParkedSighting } from "./install.js";
import { NEW_INSTALL_DREAMING_LINE, beginNewInstall } from "../../core/onboarding.js";
// The console's shared manners (2026-09-21): is there a person here, ask them,
// and say one marked line back.
import { isPromptAborted, ui, ask } from "./ui.js";
import type { Ui } from "./ui.js";
// A's two modules: the host's files, and leaving. They import nothing from here
// but the `Io` type, so this direction is one-way.
import { tilde, realSpawner, realProcessLister, wire, unwire, sessionsNote, look } from "./wire.js";
import type { WireResult, Spawner, WireInput, ProcessLister } from "./wire.js";
import { desktopUnavailable, connectDesktop, repairDesktop } from "./desktop.js";
import type { DesktopRepair } from "./desktop.js";
import { bundledModelDir } from "../runtime.js";
import { DESKTOP_ALWAYS_ALLOW } from "../hosts.js";
// `humanBytes` comes from `uninstall.ts` rather than from the private one
// below: the two spell a size differently ("7.6 MB" against "7.6 MiB"), and
// the folder `install` offers to bring back is the one `uninstall --park` set
// aside — the same folder, named twice on two screens, has to carry the same
// number.
import { humanBytes as humanDiskBytes, uninstallJson, uninstall } from "./uninstall.js";
import type { UninstallInput } from "./uninstall.js";
import {
  EXIT,
  openStoreAt,
  prefixedRefusal,
  describeDirRefusal,
  openCounterpart,
  customConfigPath,
  hostConfigFor,
  exitFor,
} from "./commands-shared.js";
import type { Parsed, Io, RunOptions } from "./commands-shared.js";

// ── install ─────────────────────────────────────────────────────────────────

/**
 * The cold start. It writes the two things that are OURS — the store and the
 * adapter's configuration beside it — and PRINTS the two that belong to the
 * host.
 *
 * The refusal direction matters more than the happy path: an existing
 * configuration is KEPT and reported, never merged and never silently
 * rewritten, because the file it would rewrite is the one pointing at somebody's
 * live memory. `--force` is the only way past that, and it says so.
 */
export function installCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  home?: string,
  named?: ConfigChoice,
  /**
   * THE HOST'S TWO STEPS, printed by default and skipped by exactly one caller.
   *
   * `start-fresh` re-uses this whole command to create its blank store — that is
   * the "invent no second install path" rule — but step 2, "register the MCP
   * server", is FALSE on that path: the store lands at the path the
   * registration already names, so there is nothing to re-register. Printing it
   * anyway would teach the owner to run a command he does not need on the one
   * day he is most likely to follow instructions literally. So the tail is
   * separable, and that caller prints its own three lines instead.
   */
  opts: {
    hostSteps?: boolean;
    nameAlreadySaid?: boolean;
    quiet?: boolean;
    /** False for the conversational arm, which has already ASKED about a
     *  parked memory (`offerParkedMemory`) and must not say it twice. */
    parkedNotice?: boolean;
    /** True for the conversational arm: a configuration this call CREATES
     *  gets the local embedder switched on when no flag said otherwise. */
    defaultEmbedder?: boolean;
    /**
     * What a store this call CREATES starts as (`core/onboarding.ts#beginNewInstall`):
     * `install` (the default) — the first meeting `not_started` and dreaming
     * `auto`; `start-fresh` — the meeting only (a fresh store is a fresh
     * meeting), the dreaming setting left to its default, as a returning
     * owner's blank store has always started.
     */
    newInstall?: "install" | "start-fresh";
  } = {},
): number {
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  // A configuration at a NON-DEFAULT LOCATION moves the whole base — config and
  // the default store beneath it (`install.ts#installLayout`).
  // The test is the PATH, not how it was named: `--config` spelling out the
  // default path is the default install, and printing a flag for it (with a
  // sentence saying it is "NOT at" the path it is at) would be false.
  const home_ = home ?? homedir();
  const custom =
    named !== undefined &&
    named.source !== "default" &&
    resolve(named.path) !== defaultConfigPath(home_)
      ? named.path
      : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);
  // Before a single directory: a store that would hold its own configuration is
  // a store that never opens again.
  const refusal = layoutRefusal(layout);
  if (refusal !== null) {
    io.err(refusal);
    return EXIT.refused;
  }
  // And before that: the DEFAULT configuration is never written pointing at a
  // throwaway store (`install.ts#throwawayDefaultRefusal`). That is the shape
  // the 2026-09-04 incident took — the live `claude-code.json` rewritten with a
  // temp `dataDir`, three days of memory recorded nowhere. Independent of the
  // explicit-dir guard on purpose: the incident happened in a shell that had
  // neither the guard nor the home mock, so a refusal that needed either would
  // not have been there.
  const throwaway = throwawayDefaultRefusal(layout, env, home_);
  if (throwaway !== null) {
    io.err(throwaway);
    return EXIT.refused;
  }

  // A PARKED MEMORY IS NAMED HERE TOO, AND ONLY NAMED (review M4).
  //
  // `offerParkedMemory` asks — and it is interactive-only, so a pipe, a script,
  // CI, `--yes` and `--no-connect` at a terminal all walked past a parked
  // folder, made a blank store beside it, and said nothing at all. That is the
  // hazard this feature's own docstring names ("a second store the person does
  // not know about"), reached by the one arm that had no words for it.
  //
  // PRINTED RATHER THAN REFUSED, deliberately. A refusal would change what a
  // scripted caller's exit code means, on a path that has worked since day one
  // — `tools/install-loop/run.sh` and every CI job install into a fresh home —
  // and it would make a folder this command never touches able to stop it. Four
  // lines of stdout cannot surprise anybody; a new non-zero exit can. Nothing
  // below writes, renames or opens anything.
  if (opts.parkedNotice !== false && !existsSync(layout.base)) {
    const found = parkedSiblings(layout.base, home_);
    if (found.length > 0) {
      io.out(`Memory was set aside beside ${tilde(layout.base, home_)} and is NOT being brought back:`);
      for (const one of found) {
        io.out(
          `  ${tilde(one.path, home_)}  ${one.refusal === null ? humanDiskBytes(one.bytes) : "(cannot be brought back — run install at a terminal for the reason)"}`,
        );
      }
      io.out("This makes a SECOND, blank store beside it. To bring that one back instead,");
      io.out(`run \`${BIN.cli} install\` at a terminal: it asks first, and moves nothing on its own.`);
      io.out("");
    }
  }

  let budgetBytes: number | undefined;
  const budgetFlag = parsed.flags["budget"];
  if (typeof budgetFlag === "string" && budgetFlag.length > 0) {
    // The rule lives in `install.ts` so a caller can ask it BEFORE it acts
    // (N1 review M1 — this refusal used to land after two renames).
    const why = budgetRefusal(budgetFlag);
    if (why !== null) {
      io.err(why);
      return EXIT.refused;
    }
    budgetBytes = Number(budgetFlag);
  }
  const name = typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined;
  const force = parsed.flags["force"] === true;
  // RECALL BY MEANING, ON OR OFF — and only the local table (roadmap C3).
  //
  // `--embedder` turns it on, `--no-embedder` leaves it off, and the terminal
  // arm passes `defaultEmbedder` so a configuration it CREATES has it on
  // without a question (the table sends nothing anywhere, so there is no
  // egress to consent to). Nothing said → nothing written, and a forced
  // re-install carries the old block forward untouched — and a file with no
  // block reads as the table ON at runtime anyway
  // (`config.ts#resolveEmbedder`). Both flags at once is a line that
  // contradicts itself, and it is refused before anything exists.
  const embedderOn = parsed.flags["embedder"] === true;
  const embedderOff = parsed.flags["no-embedder"] === true;
  if (embedderOn && embedderOff) {
    io.err("refused: --embedder and --no-embedder were both given. Pick one; nothing was written.");
    return EXIT.usage;
  }
  const embedderSaid: boolean | undefined = embedderOn
    ? true
    : embedderOff
      ? false
      : opts.defaultEmbedder === true && !existsSync(layout.config)
        ? true
        : undefined;

  // The store first, and through `Store` itself, so the forbidden-root guard
  // runs before a single directory is created (scar §2.13).
  const existed = storeExists(layout.store);
  let store: Store;
  try {
    store = openStoreAt({ dir: layout.store });
  } catch (err) {
    io.err(prefixedRefusal(describeDirRefusal(err, layout.store)));
    return EXIT.refused;
  }
  const resolved = store.dir;
  // A NEW INSTALL'S STARTING STATE (onboarding, 2026-10-11): the first meeting
  // `not_started` and dreaming `auto`, written ONLY into a store this call has
  // just created. A store that was already here — every upgrade, Mike's
  // included — is never touched: it has no meeting key, which reads `done`,
  // and its dreaming setting is whatever it was. `start-fresh`'s blank store
  // gets the meeting and not the dreaming change; its `--undo` renames the
  // parked store back, and that store's own state with it.
  if (!existed) {
    try {
      beginNewInstall(store, { dreaming: opts.newInstall !== "start-fresh" });
    } catch (err) {
      store.close();
      io.err(prefixedRefusal(describeDirRefusal(err, layout.store)));
      return EXIT.failed;
    }
  }
  store.close();

  // SEED THE CORE NOW, not at the first hook. `install` used to write the name
  // into the config and stop there — `openAdapter` passes `config.identity` to
  // `Counterpart.open`, so the core appeared only when a session first fired.
  // Two things were wrong with that. §3 says "It seeds the identity core" of a
  // command that had not yet; and `init --name` DID seed it immediately, so the
  // two commands the same page calls interchangeable produced different stores
  // (found 2026-09-04, when a captured recall reproduced one row higher than
  // the page said). Same door as `init`: `Counterpart.open`'s own option, which
  // is an ENSURE, so the hook's later call finds it and mints nothing.
  let seeded = false;
  if (name !== undefined && name.length > 0) {
    const brain = openCounterpart(resolved, false, { name });
    try {
      seeded = true;
    } finally {
      brain.close();
    }
  }

  // `--force` MAY NOT BLANK A SETTING (adversarial review B1, 2026-09-22) — the
  // argument the credentials file carried from I32 until it was removed,
  // applied to the configuration.
  //
  // The old comment below says "a config is regenerable from this command's own
  // flags". That is true only if the flags were all TYPED, and on a re-install
  // they are not: `configObject` writes `identity` only from `--name` and
  // `embedder` only from `--embedder`, so `install --force` over a working
  // install dropped the owner's name, a running third-party egress opt-in and a
  // ceiling somebody chose — silently, and on the restore path one line after
  // the screen said the parked folder came back untouched.
  //
  // So a forced write CARRIES FORWARD what the file already said, and only for
  // keys this command line did not supply: a flag still wins, and `dataDir`,
  // which this install resolved itself, is never taken from the old file,
  // because moving an install is exactly what `--force` is for. What was kept
  // is SAID, below, on both arms.
  // The block is decided against the file being REPLACED (`resolveEmbedderBlock`),
  // read before anything below writes.
  const embedderBlock = resolveEmbedderBlock({
    enabled: embedderSaid,
    configPath: layout.config,
  });
  const carried = force
    ? carryForward(layout.config, {
        budget: budgetBytes !== undefined,
        name: name !== undefined && name.length > 0,
        embedder: embedderBlock !== undefined,
      })
    : {};
  const body = configObject({
    layout,
    ...(budgetBytes === undefined ? {} : { budgetBytes }),
    ...(name === undefined ? {} : { name }),
    ...(embedderBlock === undefined ? {} : { embedder: embedderBlock }),
    carried,
  });
  const config = writeOnce(layout.config, `${JSON.stringify(body, null, 2)}\n`, { force });
  // THE STORE STEP IS SILENT ON THE CONVERSATIONAL ARM (2026-09-22, item 10).
  //
  // A person installing a memory layer did not ask to be shown three files
  // being created; the screen the owner signed off on says one thing about all
  // of it, at the end: "Your memory lives at ~/.counterparts." So the ROUTINE
  // lines go through `say`, which the interactive caller silences.
  //
  // WHAT IS NEVER SILENCED: a warning, and a refusal. `io.err` is untouched,
  // and the facts a reader would act on — a replaced configuration, and a
  // `--dir` that moved the store away from the configuration — print on both
  // arms. Quiet means fewer receipts, never a fact withheld.
  const say = opts.quiet === true ? (_line: string): void => {} : (line: string): void => { io.out(line); };
  say(existed ? `Store already present at ${resolved}.` : `Created a store at ${resolved}.`);
  // **A REPLACED CONFIGURATION IS NOT A ROUTINE RECEIPT** (review B1). Creating
  // one, or keeping one, is bookkeeping; OVERWRITING the file the hooks, the
  // worker and the MCP server all read is a fact a reader would act on, and the
  // rule stated above is "quiet means fewer receipts, never a fact withheld".
  // So this one line goes to `io.out` on both arms, and names what survived.
  if (config.what === "replaced") {
    io.out(`  replaced ${config.path}`);
    const kept = Object.keys(carried);
    if (kept.length > 0) {
      io.out(`    kept from the file it replaced: ${kept.join(", ")}.`);
      io.out("    A flag on this line would have won; none was given for those.");
    }
  } else {
    say(`  ${config.what} ${config.path}`);
  }
  // The SAME sentence `init` prints, because the two commands did the same
  // thing: a page that calls them interchangeable and then has them say it
  // differently has made the reader do the comparison.
  // The conversation (`installInteractive`) has already said this, one step up, in
  // the person's own answer; saying it twice is the wall of text the owner named.
  if (seeded && opts.nameAlreadySaid !== true) {
    say(`  identity core seeded for ${name ?? ""} — the thing this memory is about.`);
  }
  if (!isWithin(layout.base, resolved)) {
    // --dir moved the STORE. It does not move the configuration: the hooks read
    // the default path unless something NAMES another one (--config, else
    // COUNTERPARTS_CONFIG), and a hook that finds no config stands down and
    // exits 0 — so a config nothing points them at is a silence nobody debugs.
    // Said out loud rather than left for the reader to discover from an ambient
    // half that never fires.
    io.out("");
    io.out(`  --dir moved the STORE only. The configuration stays at ${config.path}:`);
    io.out(
      custom === undefined
        ? "  that is the path the hooks read when nothing names another one,"
        : `  and the printed lines below name it with ${CONFIG_FLAG} / ${CONFIG_ENV},`,
    );
    io.out(`  and it points at your store with "dataDir": "${resolved}".`);
  }
  if (config.what === "kept") {
    say("  (an existing file is never rewritten — pass --force to replace it)");
  }
  if (budgetBytes === undefined) {
    say("");
    say('  NO "injectionBudgetBytes" was written: nobody told us this host\'s ceiling');
    say("  and this package invents none (scar §2.18). Re-run with --budget <bytes>,");
    say(`  or add the key to ${config.path}.`);
  }

  if (opts.hostSteps !== false) printHostSteps(io, resolved, custom, home_);
  return EXIT.ok;
}

/**
 * WHAT A FORCED WRITE KEEPS FROM THE CONFIGURATION IT IS REPLACING (B1).
 *
 * The keys this command can write but cannot RE-DERIVE: `identity` comes only
 * from `--name`, `embedder` only from `--embedder`, and the ceiling only from
 * `--budget`. A re-install that passes none of the three is the ordinary case —
 * the owner's own 0.2.0 trial is one — and before this the three were simply
 * gone, with nothing on screen.
 *
 * Two rules in the shape of it:
 *
 *   - **A flag always wins.** A key the command line supplies is not carried,
 *     so there is no merge and no precedence to get wrong later.
 *   - **`dataDir` is NEVER carried.** This install resolved it
 *     (`installLayout`), and `--force` over a config that names somewhere else
 *     is exactly how an install is moved. Carrying it would make the move
 *     silently not happen.
 *   - **Settings this build no longer reads are not carried either** —
 *     `credentialsFile`, `models`, `crashWriteUp`, `stopAskShape` (the keys
 *     were removed on 2026-09-24). A rewrite is the natural moment to let them go.
 *
 * It reads the file with `JSON.parse` rather than `loadConfig`: what is wanted
 * is what the file SAID, key for key, not what a loader makes of it — an
 * unreadable or non-object file carries nothing, which is the same answer the
 * ordinary write path gives it.
 */
export function carryForward(
  configPath: string,
  supplied: { budget: boolean; name: boolean; embedder: boolean },
): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const was = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Every key the file holds that is NOT one of the four this command resolves
  // or is being given. Anything an owner added by hand is in here too, which is
  // the point: `--force` was typed to fix a config, not to normalise it.
  for (const [key, value] of Object.entries(was)) {
    if (key === "dataDir" || key === "owner") continue;
    if (key === "credentialsFile" || key === "models" || key === "crashWriteUp" || key === "stopAskShape") continue;
    if (key === "injectionBudgetBytes" && supplied.budget) continue;
    if (key === "identity" && supplied.name) continue;
    if (key === "embedder" && supplied.embedder) continue;
    out[key] = value;
  }
  return out;
}

/**
 * The two steps that belong to the HOST, printed and never applied — split out
 * of `installCommand` so the one caller they are false for can skip them
 * (2026-09-20, N1). Nothing here writes anything.
 */
function printHostSteps(io: Io, resolved: string, custom: string | undefined, home_: string): void {
  io.out("");
  io.out("Two steps left, and they are the HOST'S files, so they are printed, not applied.");
  io.out("Nothing below has been written and no host configuration was read.");
  io.out("");
  io.out("  1. Merge this into ~/.claude/settings.json (one script, five events):");
  io.out("");
  for (const line of settingsBlock(hookCommand(custom)).split("\n")) io.out(`     ${line}`);
  io.out("");
  io.out("     The runtime and the script are ABSOLUTE on purpose. A host's process");
  io.out("     environment is not your login shell's, so");
  io.out(`     '${BIN.hook}' on a PATH that lacks the runtime is a`);
  io.out("     hook that never runs and says nothing.");
  io.out("");
  io.out("  2. Register the MCP server, so remember, recall and session_end exist:");
  io.out("");
  io.out(`     ${mcpCommand(resolved, undefined, custom)}`);
  io.out("");
  // THE FLAG IS PRINTED ONLY WHEN IT IS NEEDED, and when it is, the output says
  // why — otherwise a reader learns the wiring as "hooks take a --config", which
  // is exactly the sentence this rule does not want them to carry away. The
  // default path IS the rule (`adapters/config-path.ts`).
  if (custom !== undefined) {
    io.out(`  Both lines carry this install's configuration, because it is NOT at`);
    io.out(`  ${defaultConfigPath(home_)} — the path all four entry points`);
    io.out(`  read when nobody says otherwise. The hook takes it as ${CONFIG_FLAG} <path>; the`);
    io.out(`  server takes it as ${CONFIG_ENV}, because this host launches MCP servers`);
    io.out("  from a static registration with no command line to write into.");
    io.out("");
  }
  // `doctor`, not `status --dir`: doctor is the "does it work" check on every
  // page since 2026-09-22, and it reads the configuration the hooks read.
  io.out(
    `  Then restart Claude Code, and check it with: ${BIN.cli} doctor${custom === undefined ? "" : ` --config ${custom}`}`,
  );
  io.out("  An MCP server keeps the code it was launched with: after an upgrade, restart");
  io.out("  every open session or the old server keeps serving.");
  io.out("");
  io.out(`  Or have it done for you: ${BIN.cli} connect`);
}

// ── install, as a short conversation ────────────────────────────────────────

/**
 * The same install, with a person in the room.
 *
 * **Everything about the files is `installCommand`'s, unchanged.** This wraps
 * it: it asks for a name, hands the same flags to the same function, connects
 * the host and ends on two lines. There is deliberately
 * no second code path that creates a store — that is the rule `start-fresh`
 * already follows ("invent no second install path"), and it is what keeps the
 * refusals (`layoutRefusal`, `throwawayDefaultRefusal`) true on this arm
 * without being restated.
 *
 * Reached only when `ui.ts#isInteractive` says there is a person who can
 * answer: stdin AND stdout are terminals, `CI` is unset, this console has a
 * prompt, and `--no-connect` was not passed. Everything else — a pipe, a
 * script, `tools/install-loop/run.sh`, every test in the suite — goes to
 * `installCommand` and gets today's bytes.
 *
 * ── WHAT 2026-09-22 CHANGED, AND WHY (the owner's items 9, 10, 11) ──────────
 *
 *   - **No step numbers.** `[1/4]` counted questions the person had not asked
 *     to be asked. The screen is now five short exchanges with blank lines
 *     between them.
 *   - **Claude Code is connected BY DEFAULT**, not offered. Ruling 1 of 09-21
 *     ("wire by default, after asking first") is replaced: a person who typed
 *     `install` has asked. `--no-connect` and every scripted console still get
 *     the printed blocks and no edit at all, which is the half that must not
 *     move.
 *   - **The store step is silent** (`quiet`), and says one thing at the end.
 *   - **`install` is the undo of `uninstall --park`**: before anything else, a
 *     parked folder beside the configuration directory is offered back.
 *
 * THE RE-RUN IS THE SECOND MOST COMMON PATH and reads as one: a store that is
 * already there greets you instead of asking your name again, and a connection
 * that is already in place says so instead of being redone.
 */
/**
 * `install --host claude-desktop` (2026-09-30, brief item 7). The store and
 * the configuration exactly as the scripted install makes them — kept when they
 * exist, as always — and then, instead of Claude Code's hooks and `claude mcp
 * add`, a `counterparts` entry merged into Claude Desktop's own config file
 * (`desktop.ts#connectDesktop`: backed up first, every other server left as it
 * was, nothing written at all when the same entry is already there). The
 * Desktop file is found under the home directory this command was given, never
 * `os.homedir()` behind its back.
 */
export function installDesktop(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  home: string | undefined,
  named: ConfigChoice | undefined,
  now: () => number,
): number {
  const home_ = home ?? homedir();
  const unavailable = desktopUnavailable(process.platform, home_);
  if (unavailable !== null) {
    io.err(unavailable);
    return EXIT.refused;
  }
  const code = installCommand(parsed, io, env, home_, named, { hostSteps: false });
  if (code !== EXIT.ok) return code;
  const custom = customConfigPath(named, home_);
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);
  const store = hostConfigFor(layout.config).config.dataDir ?? layout.store;
  const result = connectDesktop({
    home: home_,
    store,
    exe: process.execPath,
    ...(custom === undefined ? {} : { configPath: custom }),
    now: now(),
  });
  io.out("");
  switch (result.outcome) {
    case "already":
      io.out(`Claude Desktop: already connected — ${tilde(result.path, home_)} has this entry, and nothing was changed.`);
      return EXIT.ok;
    case "added":
    case "updated":
      io.out(`Claude Desktop: ${result.outcome === "added" ? "connected" : "entry updated"} in ${tilde(result.path, home_)}.`);
      // A REPLACED ENTRY THAT NAMED ANOTHER STORE IS NAMED (review of #294):
      // Desktop's memory moves with this line, and the old one is not gone.
      if (result.previousStore !== undefined && result.previousStore !== null && result.previousStore !== store) {
        io.out(`  It named another store before: ${result.previousStore} — that memory is still there; Desktop now uses ${store}.`);
      }
      if (result.backup !== null) io.out(`  backed up first: ${result.backup}`);
      io.out("  Every other server in that file was left as it was.");
      // Desktop rewrites its own config file while it runs, so a change made
      // under a running Desktop can be written over.
      io.out("If Claude Desktop was open while this ran, quit it and run this again — it rewrites its own config file while it runs.");
      io.out("Then open Claude Desktop. In a new chat, ask it to call the counterparts wake tool first (or pick the \"Start with Counterparts\" prompt where Desktop lists it).");
      // MEASURED 2026-10-02: a chat whose tools still asked permission never
      // called `wake`, answered from recall alone, and called that the full
      // record. Doctor cannot see the setting, so this says it.
      io.out(DESKTOP_ALWAYS_ALLOW);
      io.out(`Then run \`${BIN.cli} doctor\`: its Claude Desktop line shows the entry, and the last wake once there has been one.`);
      return EXIT.ok;
    case "refused":
      io.err(result.detail ?? "refused");
      return EXIT.refused;
    default:
      io.err(`Claude Desktop's config could not be written: ${result.detail ?? "unknown"}${result.backup === null ? "" : ` (a backup was taken first: ${result.backup})`}.`);
      return EXIT.failed;
  }
}

export async function installInteractive(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  // CTRL-C (and, since 2026-09-22, Esc) IS NOT AN ANSWER, at ANY of this
  // conversation's questions (review m4). It used to end the process silently
  // with exit 0 — at the name prompt nothing existed yet, at the wire question
  // the store and the config both did, and a `&&`
  // chain read that zero as "installed". Every prompt reports from the
  // FILESYSTEM rather than from a flow that was abandoned halfway, which is
  // also what makes it true either side of the parked folder's one rename.
  try {
    return await installConversation(parsed, io, env, opts, named, now);
  } catch (err) {
    if (!isPromptAborted(err)) throw err;
    const home = opts.home ?? homedir();
    const custom = customConfigPath(named, home);
    const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
    const layout = installLayout(dirFlag, env, home, custom);
    const u = ui(io, env);
    u.blank();
    u.fail("stopped; nothing else was changed.");
    u.hint(
      storeExists(layout.store) ? `Your store is at ${layout.store}.` : "No store was created.",
    );
    if (existsSync(layout.config)) u.hint(`Its configuration is ${layout.config}.`);
    u.hint(`Run \`${BIN.cli} install\` again whenever you like; it picks up where this left off.`);
    return EXIT.refused;
  }
}

async function installConversation(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  const home_ = opts.home ?? homedir();
  const u = ui(io, env);
  const custom = customConfigPath(named, home_);
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);

  u.heading(`${BIN.cli} install`);
  u.blank();

  // ── a memory that was set aside ───────────────────────────────────────────
  //
  // FIRST, before the name question: everything below reads differently once a
  // parked folder is back in place, and asking somebody their name and then
  // discovering their memory is the wrong order to meet a stranger in.
  if ((await offerParkedMemory(io, u, layout, home_)) === "stopped") return EXIT.refused;

  // ── the name ──────────────────────────────────────────────────────────────
  //
  // ASKED AFTER THE PARKED BRANCH, never before it: a folder that just came
  // back holds a store and an identity core, and a run that had already decided
  // "there is nothing here" would ask a returning owner his name and then try
  // to seed a core into a store that has one.
  const already = storeExists(layout.store);
  const flags: Record<string, string | boolean | undefined> = { ...parsed.flags };
  let name = typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined;
  if (already) {
    // THE NAME COMES OUT OF THE CONFIGURATION, not out of the store. It is the
    // same value `openAdapter` hands `Counterpart.open` as `identity`, so it IS
    // the core's name for every store this command made — and reading it costs
    // no `Store.open` at all, which matters most on the path where the store was
    // a parked folder thirty lines ago.
    const known = hostConfigFor(layout.config).config.identity?.name;
    io.out(known === undefined || known.length === 0 ? "Welcome back." : `Welcome back, ${known}.`);
    // A `--name` HERE CHANGES NOTHING, AND SAYS SO (review m2). The identity
    // core is an ENSURE — `Counterpart.open` keeps the name it has — and the
    // configuration is kept, so the flag was accepted, ignored, and invisible.
    // A flag that is silently dropped is one somebody re-passes forever.
    if (name !== undefined && name.trim().length > 0 && name.trim() !== known) {
      u.hint(
        known === undefined || known.length === 0
          ? `--name was not used: this memory already exists, and a name is only seeded when one is made.`
          : `--name was not used: this memory is already called ${known}.`,
      );
    }
  } else if (name !== undefined && name.trim().length > 0) {
    io.out(`Nice to meet you, ${name.trim()}.`);
  } else {
    const answer = (await ask(io, "What should this memory call you?")).trim();
    if (answer.length === 0) {
      name = undefined;
      delete flags["name"];
      u.hint("No name, so no identity core — the wake will have nothing to be about.");
      u.hint(`Add one later with: ${BIN.cli} init --dir ${layout.store} --name "<your name>"`);
    } else {
      name = answer;
      flags["name"] = answer;
      io.out(`Nice to meet you, ${answer}.`);
    }
  }
  // THE ZONE, SAID ONCE AND NOT ASKED (docs/time.md rule 2, 2026-09-25): times
  // follow the computer, so there is nothing to answer — but a person should
  // see which clock their memory will read, and how to pin another.
  const zoneSet = hostConfigFor(layout.config).config.timeZone;
  u.hint(
    zoneSet === undefined
      ? `Times read in ${resolveZone(undefined)}, this computer's zone — "timeZone" in the config pins another.`
      : `Times read in ${zoneSet}, as the config's "timeZone" says.`,
  );
  u.blank();

  // ── the store and the configuration — SILENTLY ────────────────────────────
  //
  // THE CEILING GETS A NUMBER ON THIS ARM ONLY. Scar §2.18 says this package
  // invents no host ceiling, and nothing about that changes for a script: the
  // non-interactive arm still ends on its "NO injectionBudgetBytes was written"
  // paragraph. What changes here is that there is a person, and the sentence
  // explaining the knob moved off this screen into `help install` (item 10) — a
  // number that works is worth more to a stranger than a paragraph of homework.
  // A `--budget` on the line still wins.
  //
  // AND IT IS INJECTED ONLY WHEN THE CONFIGURATION IS BEING CREATED (review
  // B1). An injected default is a value nobody typed, so on a forced re-install
  // it counted as "supplied", beat the carry-forward, and rewrote a ceiling
  // somebody had chosen back to 9000 — the same failure as the one the carry
  // exists to prevent, arriving through the fix for it.
  const suppliedBudget =
    typeof parsed.flags["budget"] === "string" ? parsed.flags["budget"] : undefined;
  if (suppliedBudget === undefined && !existsSync(layout.config)) {
    flags["budget"] = String(DEFAULT_BUDGET_BYTES);
  }
  const configExisted = existsSync(layout.config);
  const code = installCommand({ command: "install", positional: [], flags }, io, env, home_, named, {
    hostSteps: false,
    nameAlreadySaid: true,
    quiet: true,
    // This arm ASKED, a few lines up. The scripted arm's notice would repeat
    // the answer back at somebody who has just given it.
    parkedNotice: false,
    // RECALL BY MEANING IS ON FOR A PERSON'S NEW INSTALL (roadmap C3). The
    // local table sends nothing anywhere, so there is no egress to ask about
    // and no question on this screen; `--no-embedder` still says no. Only a
    // configuration being CREATED gets it — a re-run keeps the file it finds,
    // like every other key in it (the budget default above, same rule).
    defaultEmbedder: true,
  });
  if (code !== EXIT.ok) return code;
  // AN EMBEDDER FLAG OVER A KEPT CONFIGURATION CHANGES NOTHING, AND SAYS SO —
  // the rule `--name` follows above. Rule 2 keeps the file; the scripted arm's
  // "(an existing file is never rewritten…)" receipt is silenced on this arm,
  // so without this line the flag would be accepted, ignored and invisible.
  if (
    configExisted &&
    parsed.flags["force"] !== true &&
    (parsed.flags["embedder"] === true || parsed.flags["no-embedder"] === true)
  ) {
    u.hint(
      `${parsed.flags["embedder"] === true ? "--embedder" : "--no-embedder"} was not used: this configuration already exists and is kept. ` +
        `\`${BIN.cli} install --force ${parsed.flags["embedder"] === true ? "--embedder" : "--no-embedder"}\` rewrites it, keeping every other setting.`,
    );
  }

  // ── Claude Code ───────────────────────────────────────────────────────────
  //
  // The store the server is told about is read back OUT OF THE FILE that was
  // just written, never re-derived: `install` resolves the path through
  // `Store.open`, so the configuration is the one thing that knows where the
  // store actually landed.
  const config = hostConfigFor(layout.config).config;
  const store = config.dataDir ?? layout.store;
  const spawner = opts.spawner ?? realSpawner(env);
  const lister = opts.processes ?? realProcessLister(env);
  let wired: WireResult | null = null;
  if (!claudeCodeHere(home_, env, spawner)) {
    // NOT AN ERROR AND NOT A REFUSAL (item 9: "say so, move on"). Everything
    // this command actually owns — the store and the configuration — is done, and the one part that needs somebody else's
    // program can be done the day they have it.
    io.out("Claude Code is not on this machine, so there was nothing to connect.");
    u.hint(`When you have it, run \`${BIN.cli} connect\`.`);
  } else {
    io.out("Connecting Claude Code…");
    // `yes: true` because THE QUESTION IS GONE. Connecting is what `install`
    // does now; the opt-out is `--no-connect`, which never reaches this arm at
    // all — it makes the console non-interactive one level up.
    wired = await wire({
      io,
      env,
      home: home_,
      configPath: layout.config,
      custom,
      store,
      now: now(),
      yes: true,
      dryRun: false,
      exe: process.execPath,
      spawner,
      lister,
      heading: false,
    });
    if (wired.hooks === "declined" || wired.outcome !== "ok") {
      u.hint("Your store is made either way; connecting is the only part not done.");
      u.hint(`You can do it later with: ${BIN.cli} connect`);
    }
  }
  // CLAUDE DESKTOP'S ENTRY, REPAIRED AS `connect` REPAIRS IT (2026-10-10, left
  // open by #354): an entry `install --host claude-desktop` wrote in an older
  // shape gets today's command, by the same path and with the same refusal
  // while Desktop runs (`repairDesktopEntry`). Outside the Claude Code question
  // on purpose: Desktop's file is there or not whether Claude Code is. Only
  // this arm: the scripted install reads no host file at all.
  const desktop = repairDesktopEntry(io, env, home_, lister, false, now());
  // Left in the old shape, Desktop's entry keeps doctor's Runtime line amber.
  const desktopPending = desktop.outcome === "desktop-running" || desktop.outcome === "failed";
  // A Desktop file that does not parse was left alone too, but doctor cannot
  // read an entry in it either, so its Runtime line is green: the ending can
  // promise neither green nor amber for Desktop (review of #356).
  const desktopUnread = desktop.outcome === "refused";
  u.blank();

  // ── no keys ───────────────────────────────────────────────────────────────
  //
  // THERE ARE NO API KEYS (roadmap C3, 2026-09-23; removed outright 2026-09-24).
  // Recall by meaning runs on the local table switched on above, and a session
  // that ended before it was written up is written up by the next session in
  // that project.
  //
  // WHAT WAS SWITCHED ON IS SAID, in one line, where the key questions used to
  // be (the owner's answer to review NIT 8, 2026-09-23, his wording): recall by
  // meaning is on and runs here. Only when it is true — the table is on AND it
  // is where the hooks will look.
  //
  // When the table this configuration asks for is NOT where the hooks will
  // look, that is said instead. The weights ship as the package's one
  // dependency, so on an ordinary install this never prints — it is the
  // from-source checkout, or a dependency that did not land, and a screen that
  // ended "it should be all green" over an amber would be the silence review
  // M1 named.
  //
  // Looked for the way the hooks will look (`resolveStaticWeights`: the
  // environment variable, then the installed package), and then for the table
  // FILE in what that found — a variable naming an empty folder is not a table.
  const bundled = bundledModelDir();
  const table = resolveStaticWeights({ env, ...(bundled === undefined ? {} : { packageDir: bundled }) });
  const tableOn = config.embedder?.enabled === true;
  const tableMissing = tableOn && (table === null || !existsSync(join(table.dir, MODEL_FILE)));
  if (tableOn && !tableMissing) {
    io.out("Recall by meaning: on. A small model runs on your machine; nothing is sent anywhere.");
    u.blank();
  }
  // DREAMING IS ON FOR A NEW INSTALL (2026-10-11), and a person is told so
  // where they can see it, with the way to turn it off. A re-run over a store
  // that was here keeps its setting and says nothing about it.
  if (!already) {
    io.out(NEW_INSTALL_DREAMING_LINE);
    u.blank();
  }
  if (tableMissing) {
    u.warn("recall by meaning is on, but its table was not found — recall will match on words only.");
    u.hint(`Install it: bun add -g ${STATIC_WEIGHTS_PACKAGE} — or set ${STATIC_WEIGHTS_ENV} to a folder holding it.`);
    u.blank();
  }

  // ── the last two lines ────────────────────────────────────────────────────
  //
  // THE FOLDER, NOT THE STORE, and `~` rather than the spelled-out home: what a
  // person wants to be able to find again is `~/.counterparts`, which holds the
  // memory and the configuration. A `--dir` that moved the store out
  // of that folder is named instead, because then the folder is not where the
  // memory lives and the sentence would be false.
  const memoryAt = isWithin(layout.base, store) ? layout.base : store;
  io.out(`Done. Your memory lives at ${tilde(memoryAt, home_)}.`);
  // "IT SHOULD BE ALL GREEN" IS A PROMISE, AND IT NEEDS BOTH HALVES (review
  // M1). It used to read `wired.hooks` alone, so an install whose `claude mcp
  // add` had just failed — warning and all, four lines up — still ended by
  // telling the person to expect a green doctor. Doctor is RED on that line,
  // and the named failure mode of this whole product is silence. The MCP half
  // is consulted too, and a connect that did not finish says WHAT is missing
  // rather than sending somebody to a doctor they have not been warned about.
  const hooksIn =
    wired !== null &&
    (wired.hooks === "wired" || wired.hooks === "repaired" || wired.hooks === "already");
  const toolsIn =
    wired !== null &&
    (wired.mcp === "added" || wired.mcp === "re-added" || wired.mcp === "already");
  const connected = wired !== null && wired.outcome === "ok" && hooksIn && toolsIn;
  if (connected && !tableMissing && !desktopPending && !desktopUnread) {
    io.out(`Restart Claude Code, then run \`${BIN.cli} doctor\` — it should be all green.`);
  } else if (hooksIn && !toolsIn) {
    io.out("The hooks are in; the memory tools are NOT registered — the line above does that.");
    io.out(`Then restart Claude Code and run \`${BIN.cli} doctor\`.`);
  } else if (connected && desktopUnread) {
    // Desktop's file is unreadable — said above. Doctor cannot see into it, so
    // "all green" would vouch for a Desktop nobody checked.
    io.out(
      `Restart Claude Code, then run \`${BIN.cli} doctor\`. Claude Desktop's config was left as it was, as said above; once it is fixed, \`${BIN.cli} connect\` brings its entry up to date.`,
    );
  } else if (connected && !desktopPending) {
    // Connected, and the one amber is the table named above.
    io.out(`Restart Claude Code, then run \`${BIN.cli} doctor\` — everything but recall by meaning should be green.`);
  } else if (connected) {
    // Connected, and Claude Desktop's entry is still in the old shape — said
    // above, with what to do. "All green" here would be false (review M1).
    io.out(
      `Restart Claude Code, then run \`${BIN.cli} doctor\` — its Runtime line stays amber until Claude Desktop's entry is rewritten, as said above.`,
    );
  } else {
    io.out(`Run \`${BIN.cli} doctor\` to see where this got to.`);
  }
  return EXIT.ok;
}

/**
 * IS CLAUDE CODE ON THIS MACHINE AT ALL? (item 9's last clause.)
 *
 * Two questions, and either one answering yes is enough, because they fail in
 * opposite directions. The DIRECTORY is what a person who has ever run Claude
 * Code has — `CLAUDE_CONFIG_DIR` moves it (and IS it, when set: not a
 * `.claude` inside it, 2026-10-09), and `install.ts#hostSettingsDir` is the one
 * place that knows so. The BINARY on PATH is what a fresh install has
 * before it has been run, and the reason `install.ts`'s own docstring exists: a
 * process's PATH is not a login shell's, so a `claude` we cannot see may still
 * be there for the person.
 *
 * Answering "no" means only that nothing here found it; it is said in one line
 * and the install carries on. The probe is spawned ONLY when the directory is
 * absent, so a machine that has Claude Code never pays for it — and a re-run on
 * a connected install never spawns anything at all.
 */
function claudeCodeHere(
  home: string,
  env: Record<string, string | undefined>,
  spawner: Spawner,
): boolean {
  if (existsSync(hostSettingsDir(home, env))) return true;
  return !spawner(["--version"]).missing;
}

// ── install as the undo of `uninstall --park` (item 11) ─────────────────────

/**
 * Offer a parked memory back, before anything else happens.
 *
 * The trial's finding #22: after `uninstall --park` the way back was a pasted
 * shell line with an `if [ -e … ] … REFUSING … mv … fi` guard in it. This is
 * that guard, in code, behind a question — and `install` is where it lives
 * because `install` is what a person runs when they come back.
 *
 * ── THE RULES, and every one of them is mechanized in `install.ts` ──────────
 *
 *   - **The parked folder is never opened.** No store, no config, no file at
 *     all: the date comes from the NAME, the size from a walk, the floor from
 *     `preRowsMarkersIn`, which reads filenames. So there is no memory count on
 *     this screen, and the screen says why rather than leaving a gap.
 *   - **Anything that cannot be brought back is named and left**, with the
 *     reason — a symlink, a folder outside this home, a store from before the
 *     rows floor, a folder whose store was parked separately.
 *   - **Nothing moves without a typed answer.** Enter is not "start blank": a
 *     blank start beside a parked folder is a second store the person does not
 *     know about. An empty or unrecognised answer is asked once more and then
 *     stops the command with nothing changed.
 *   - **One `rename`,** and its destination is re-checked immediately before
 *     the call rather than at the top of this function (scar §2.13).
 */
async function offerParkedMemory(
  io: Io,
  u: Ui,
  layout: InstallLayout,
  home: string,
): Promise<"none" | "back" | "blank" | "stopped"> {
  // A configuration directory that is THERE is an install, not a return. The
  // question is only ever asked into an empty space.
  if (existsSync(layout.base)) return "none";
  const found = parkedSiblings(layout.base, home);
  if (found.length === 0) return "none";

  for (const one of found) {
    if (one.refusal === null) continue;
    u.warn(`${tilde(one.path, home)} cannot be brought back.`);
    u.hint(one.refusal);
  }
  const usable = found.filter((one) => one.refusal === null);
  if (usable.length === 0) {
    u.hint("Nothing here can be brought back, so this is a fresh start.");
    u.blank();
    return "blank";
  }

  let chosen: string;
  if (usable.length === 1) {
    const one = usable[0] as ParkedSighting;
    const answer = await askOnce(
      io,
      u,
      `Found memory set aside on ${one.date} (${humanDiskBytes(one.bytes)}). Bring it back, or start blank? [back/blank]`,
      (raw) =>
        raw === "back" || raw === "b" || raw === "1" ? "back" : raw === "blank" ? "blank" : null,
      "Answer back or blank.",
    );
    if (answer === null) return stoppedAtParked(io);
    if (answer === "blank") return blankBeside(u, usable, home);
    chosen = one.path;
  } else {
    // "memory folders", never "memories": in this product a memory is a row,
    // and "2 memories set aside" read as two rows on the dress rehearsal.
    io.out(`Found ${String(usable.length)} memory folders set aside, newest first:`);
    for (const [i, one] of usable.entries()) {
      io.out(
        `  ${String(i + 1)}. ${tilde(one.path, home)}  set aside ${one.date}  ${humanDiskBytes(one.bytes)}`,
      );
    }
    const tags = usable.map((_, i) => String(i + 1)).join("/");
    const answer = await askOnce(
      io,
      u,
      `Bring one back, or start blank? [${tags}/blank]`,
      (raw) => {
        if (raw === "blank") return "blank";
        const n = Number(raw);
        return Number.isInteger(n) && n >= 1 && n <= usable.length ? String(n) : null;
      },
      // NAMING THE ANSWERS RATHER THAN "the words in brackets" (review n3).
      // `back` is the word the one-candidate question takes, and somebody who
      // has met that question once will type it here, where it cannot say
      // WHICH — so the re-ask spells out the numbers instead of repeating a
      // sentence that does not help.
      `Answer ${tags.split("/").join(", ")} or blank.`,
    );
    if (answer === null) return stoppedAtParked(io);
    if (answer === "blank") return blankBeside(u, usable, home);
    chosen = (usable[Number(answer) - 1] as ParkedSighting).path;
  }

  const moved = bringParkedBack(chosen, layout.base, home);
  if (!moved.ok) {
    io.err(moved.reason);
    return "stopped";
  }
  u.ok(`brought back — ${tilde(chosen, home)} -> ${tilde(layout.base, home)}`);
  u.hint("One rename. Nothing was copied and nothing was opened, so there is no count here.");
  u.blank();
  return "back";
}

/** The question, once, then once more, then nothing. `parse` returns the
 *  canonical answer, or null for "that was not one of the choices"; `retry` is
 *  the one line between the two attempts, and it NAMES the answers rather than
 *  pointing back at the brackets. */
async function askOnce(
  io: Io,
  u: Ui,
  question: string,
  parse: (raw: string) => string | null,
  retry: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = (await ask(io, question)).trim().toLowerCase();
    const answer = parse(raw);
    if (answer !== null) return answer;
    if (attempt === 0) u.hint(retry);
  }
  return null;
}

/** An answer nobody gave is not a decision. Nothing has moved at this point —
 *  the rename is the last thing that happens — so the exit can say so. */
function stoppedAtParked(io: Io): "stopped" {
  io.err("Nothing was changed, and the memory set aside is exactly where it was.");
  return "stopped";
}

/** "Start blank" is a real answer, and it is the one where saying what was NOT
 *  touched matters most: there will now be two stores on this machine. */
function blankBeside(u: Ui, usable: readonly ParkedSighting[], home: string): "blank" {
  for (const one of usable) u.hint(`${tilde(one.path, home)} is untouched, exactly as it was.`);
  u.hint(`It stays there until you move it; \`${BIN.cli} install\` will offer it again.`);
  u.blank();
  return "blank";
}

/**
 * The interactive install's ceiling, and the ONLY default this package has for
 * one (scar §2.18 holds everywhere else, the scripted arm included). It is the
 * ceiling the self page's write limit is sized against
 * (`self/briefing.ts#PAGE_HOST_BUDGET_BYTES`, 2026-10-09), read from there so
 * the two cannot drift: 9,000.
 */
const DEFAULT_BUDGET_BYTES = PAGE_HOST_BUDGET_BYTES;

// ── connect / disconnect / uninstall ────────────────────────────────────────

/**
 * THE HOSTS THIS CONSOLE KNOWS HOW TO CONNECT — one, and the list says so.
 *
 * The owner's ruling (2026-09-22, item 3): with one host known, `connect` names
 * it and goes. A menu of one item is a question whose answer was already on the
 * screen. The NAME is still accepted — `counterparts connect claude-code` is the
 * same command — so the day there are two, a script that named its host keeps
 * working and only the bare form has to learn to ask.
 */
export const KNOWN_HOSTS: readonly string[] = ["claude-code"];

/**
 * The console's half of the three host-editing verbs: refuse `--dir`, refuse a
 * host nobody has, resolve which configuration this invocation means, read the
 * store out of it, and hand the rest to `wire.ts` / `uninstall.ts`.
 *
 * Everything that touches a host file is in those modules. This function owns
 * exactly four decisions — which host, which configuration, which store, and how
 * an outcome maps onto an exit code — so that the exit codes stay in the one
 * file that defines them.
 */
export async function hostWiringCommand(
  command: "connect" | "disconnect" | "uninstall",
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  opts: RunOptions,
  named: ConfigChoice | undefined,
  now: () => number,
): Promise<number> {
  // WHICH HOST, asked before anything is read. A name this console does not
  // know is a command line that does not mean what it says — and the refusal
  // NAMES the one it knows, because "unknown host" without a list is the
  // refusal that teaches nothing (constitution 16).
  const askedHost = parsed.positional[0];
  if (command !== "uninstall" && askedHost !== undefined && !KNOWN_HOSTS.includes(askedHost)) {
    io.err(
      `refused: '${command}' does not know a host called '${askedHost}'. The one it knows is ` +
        `${KNOWN_HOSTS.join(", ")} — and \`${BIN.cli} ${command}\` on its own means that one.`,
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }

  // `--dir` is a COMMON flag, so it parses on every command. Here it would be a
  // second answer to "which install" on commands that edit a stranger's editor
  // configuration and, in one case, rename the directory holding the memory.
  if (typeof parsed.flags["dir"] === "string") {
    io.err(
      `refused: '${command}' takes no --dir. What it acts on is decided by your ` +
        "CONFIGURATION — that is the file the hooks, the worker and the MCP server read, and a " +
        `second answer on this command line is how the wrong one gets edited. Name the ` +
        `configuration instead: ${CONFIG_FLAG} <absolute path>, or ${CONFIG_ENV}.`,
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }

  const home_ = opts.home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
  const custom = customConfigPath(named, home_);
  const present = existsSync(configPath);
  const host = hostConfigFor(configPath);
  if (present && host.reason === "unreadable") {
    io.err(
      `refused: ${configPath} is there and will not be understood. These commands read ` +
        '"dataDir" out of it to know which store to name, and a file they cannot read is a ' +
        "question they will not answer by guessing.",
    );
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  // A MISSING CONFIGURATION STOPS `connect` AND `uninstall`, AND NOT
  // `disconnect`.
  //
  // The first two need it: `connect` has to tell the server which store to open,
  // and `uninstall` has to know which directory this install's is at all. But
  // `disconnect` needs nothing out of it — it takes hooks OUT of the host's
  // settings and runs one `claude mcp remove` — and the person most likely to be
  // running it is somebody who deleted `~/.counterparts` by hand and now has
  // five hooks firing at a store that is gone. Refusing them would leave the
  // mess this command exists to clean up.
  if (!present && command !== "disconnect") {
    io.err(
      `refused: there is no configuration at ${configPath}, so there is no install here to ` +
        `${command === "uninstall" ? "remove" : command}. Run '${BIN.cli} install' first, or name ` +
        `the configuration you mean with ${CONFIG_FLAG} <absolute path>.` +
        (command === "connect"
          ? ` (\`${BIN.cli} disconnect\` does work without one: it only ever takes things out.)`
          : ""),
    );
    return EXIT.refused;
  }

  const store = host.config.dataDir ?? join(dirname(configPath), DEFAULT_STORE_DIR);
  const spawner = opts.spawner ?? realSpawner(env);
  const lister = opts.processes ?? realProcessLister(env);

  if (command === "uninstall") {
    const uninstallInput: UninstallInput = {
      io,
      env,
      home: home_,
      configPath,
      custom,
      // THE WHOLE CONFIGURATION, not just `dataDir`: the plan has to find the
      // snapshots directory and the store wherever the file put them, because "the directory the config sits in" is exactly
      // the reasoning the 2026-09-21 review broke.
      config: host.config,
      now: now(),
      yes: parsed.flags["yes"] === true,
      park: parsed.flags["park"] === true,
      deleteMemories: parsed.flags["delete-memories"] === true,
      keepMemories: parsed.flags["keep-memories"] === true,
      nothingIsOpen: parsed.flags["nothing-is-open"] === true,
      exe: process.execPath,
      spawner,
      lister,
    };
    // `--json`: the plugin command's door (`uninstall.ts#uninstallJson`).
    return exitFor(
      parsed.flags["json"] === true
        ? await uninstallJson(uninstallInput)
        : await uninstall(uninstallInput),
    );
  }

  const input: WireInput = {
    io,
    env,
    home: home_,
    configPath,
    custom,
    store,
    now: now(),
    // NO QUESTION, AND THE VERB IS THE YES (2026-09-22, item 3). `wire()` and
    // `unwire()` still hold the question — `install` is their other caller and
    // it owns when to put one — and these two commands answer it here, at the
    // call site, because somebody who typed `counterparts connect` has already
    // said what a "Connect Claude Code now? [Y/n]" would be asking them. That is
    // also why neither declares `--yes` any more: there is nothing to skip.
    yes: true,
    dryRun: parsed.flags["dry-run"] === true,
    exe: process.execPath,
    spawner,
    lister,
  };
  const result = command === "connect" ? await wire(input) : await unwire(input);
  // CLAUDE DESKTOP'S ENTRY TOO (2026-10-10): `install --host claude-desktop`
  // wrote a server command into Desktop's own file, and it needs the same
  // repair the hooks just got — but never while Desktop is open
  // (`repairDesktopEntry`).
  const desktopFailed =
    command === "connect" && repairDesktopEntry(io, env, home_, lister, input.dryRun === true, now()).outcome === "failed";
  // WHAT AN OPEN SESSION DOES NOW, printed by the CALLER (2026-09-22). `wire()`
  // used to say it itself, which put it in the middle of `install`'s screen two
  // lines above install's own "restart Claude Code, then run doctor". A
  // standalone `connect` has no such ending, so it says it here — and only when
  // something actually changed, because "restart your sessions" after "already
  // connected, nothing was changed" is advice about nothing.
  //
  // BOTH HALVES COUNT. Hooks already in place and a registration that was
  // missing is the case where the person has just gained the memory TOOLS, and
  // those are exactly the half that needs a restart; gating on the hooks alone
  // left that reader with nothing to do about it.
  if (
    command === "connect" &&
    result.outcome === "ok" &&
    (result.hooks !== "already" || result.mcp !== "already")
  ) {
    sessionsNote(ui(io, env), lister, { dataDir: store, env });
  }
  return desktopFailed && result.outcome === "ok" ? EXIT.failed : exitFor(result.outcome);
}

/**
 * CLAUDE DESKTOP'S ENTRY IN TODAY'S SHAPE — `connect`'s repair, and since
 * 2026-10-10 `install`'s at a terminal too (the other caller of `wire()`).
 * One path for both: the process look, `desktop.ts#repairDesktop` (an entry of
 * ours only, its `env` kept, backed up first, written atomically, never while
 * Desktop runs or could not be ruled out), and one line saying what happened.
 * Returns the repair; what it does to the exit is the caller's call.
 */
function repairDesktopEntry(
  io: Io,
  env: Record<string, string | undefined>,
  home_: string,
  lister: ProcessLister,
  dryRun: boolean,
  at: number,
): DesktopRepair {
  const sighting = look(lister);
  const repair = repairDesktop({
    home: home_,
    exe: process.execPath,
    desktopRunning: sighting.looked ? (sighting.desktopRunning ?? null) : null,
    dryRun,
    now: at,
  });
  sayDesktopRepair(ui(io, env), repair, home_);
  return repair;
}

/** One line about Claude Desktop's entry, or none. True when the write failed. */
function sayDesktopRepair(u: ReturnType<typeof ui>, repair: DesktopRepair, home_: string): boolean {
  const where = tilde(repair.path, home_);
  switch (repair.outcome) {
    case "none":
    case "current":
      return false;
    case "repaired":
      u.ok(
        `Claude Desktop: rewrote its counterparts entry to start the memory server the way Claude Code's now does${repair.backup === null ? "" : ` (backup: ${tilde(repair.backup, home_)})`}. It takes effect when Desktop next opens.`,
      );
      return false;
    case "would-repair":
      u.hint(`Claude Desktop: would rewrite its counterparts entry in ${where} to start the memory server the way Claude Code's does. Nothing was written.`);
      return false;
    case "desktop-running":
      u.warn(
        repair.unknownRunning === true
          ? `Claude Desktop's counterparts entry was left as it was: whether Desktop is open could not be checked, and Desktop rewrites ${where} while it runs. Quit Claude Desktop, then run \`${BIN.cli} connect\` again.`
          : `Claude Desktop is open, so its counterparts entry was left in the old shape: Desktop rewrites ${where} while it runs. Quit Claude Desktop, run \`${BIN.cli} connect\` again, then reopen it.`,
      );
      return false;
    case "refused":
      u.warn(`Claude Desktop: ${repair.detail ?? `${where} could not be read, and was left as it was.`}`);
      return false;
    case "failed":
      u.fail(`Claude Desktop's entry could not be rewritten: ${repair.detail ?? "unknown error"}`);
      return true;
  }
}

// ── init ────────────────────────────────────────────────────────────────────

/**
 * Create the data dir and PRINT the installation steps. It does not write a
 * host's configuration file: an installer that edits somebody's settings
 * without being asked is the same class of surprise as a memory layer that
 * writes without being asked. The steps are printed; the owner runs them.
 *
 * The forbidden-root refusal is not implemented here — `Store`'s constructor
 * calls `assertSafeDataDir` before it creates a single directory, so a `--dir`
 * aimed at v1's live store fails before anything exists (scar §2.13). This
 * function only has to not catch it.
 */
export function initCommand(dir: string, io: Io, home = homedir(), name?: string): number {
  const existed = storeExists(dir);
  let store: Store;
  try {
    store = openStoreAt({ dir });
  } catch (err) {
    io.err(prefixedRefusal(describeDirRefusal(err, dir)));
    return EXIT.refused;
  }
  const resolved = store.dir;
  store.close();

  // `--name` seeds the identity core, through `Counterpart.open`'s own option —
  // the same door `install` reaches by writing `identity` into the config. §3
  // routes second and scratch stores here and then says the core has no default
  // anywhere, so an `init` that could not seed one left the documented path
  // unable to produce the thing the documentation says matters. Idempotent:
  // `ensureIdentityCore` is an ENSURE.
  let seeded = false;
  if (name !== undefined && name.length > 0) {
    const brain = openCounterpart(resolved, false, { name });
    try {
      seeded = true;
    } finally {
      brain.close();
    }
  }

  io.out(existed ? `Store already present at ${resolved}.` : `Created a store at ${resolved}.`);
  io.out(
    seeded
      ? `  identity core seeded for ${name ?? ""} — the thing this memory is about.`
      : "  no identity core: pass --name \"<your name>\" to seed one. Nothing else gives a",
  );
  if (!seeded) io.out("  store one, and the wake has nothing to be about without it.");
  io.out("");
  io.out("To install the hooks (not done for you — these edit your host's settings):");
  io.out("");
  io.out("  1. Point the host at the hook entry script for every session-ending event:");
  io.out("       SessionStart, UserPromptSubmit, Stop, SessionEnd, PreCompact");
  io.out(`       installed:  ${BIN.hook}`);
  io.out("       from a clone: bun run <repo>/src/adapters/claude-code/bin/hook.ts");
  io.out("  2. Register the MCP server so the Stop ask has a way back:");
  io.out(`       installed:  ${BIN.mcp}`);
  io.out("       from a clone: bun run <repo>/src/adapters/mcp/bin/serve.ts");
  io.out("  3. Write the adapter's configuration BESIDE the store, never inside it — the");
  io.out("     layout check refuses an unclassified file in the data dir (§5 G11):");
  io.out(`       ${join(resolved, "..", "claude-code.json")}`);
  io.out('       { "dataDir": "<this dir>", "injectionBudgetBytes": <your host\'s ceiling> }');
  io.out("");
  io.out("     WHO HONORS THAT FILE, exactly: this console reads it for the injection");
  io.out(`     ceiling ('${BIN.cli} rebrief'). The HOOKS DO NOT — with no flag they read`);
  io.out(`       ${defaultConfigPath(home)}`);
  io.out("     and nothing else, falling back to COUNTERPARTS_DATA_DIR only when that");
  io.out("     file names no store. A hook that finds no config stands down quietly and");
  io.out("     exits 0 (a Stop with a question exits 2 on purpose, and that is the only");
  io.out("     non-zero a hook produces), so a config anywhere else is an ambient half");
  io.out("     that never fires and never says so — unless you NAME it: every entry point");
  io.out(`     takes ${CONFIG_FLAG} <absolute path>, else $${CONFIG_ENV}, else that default.`);
  io.out(`     To wire the hooks for you, use '${BIN.cli} install'.`);
  io.out("");
  io.out("The injection ceiling has NO default anywhere in this package: a briefing");
  io.out("refuses to render rather than compose to a number nobody chose (scar §2.18).");
  io.out("");
  io.out(`'${BIN.cli} init' makes a STORE and nothing else — a second store, a scratch`);
  io.out(`one, a store on another disk. '${BIN.cli} install' is the cold start: it owns`);
  io.out("~/.counterparts/, writes step 3 there, and prints");
  io.out("1 and 2 filled in and ready to paste.");
  return EXIT.ok;
}
