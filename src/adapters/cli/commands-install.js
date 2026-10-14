import { existsSync, readFileSync } from "node:fs";
import { resolveZone } from "../../core/time.js";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PAGE_HOST_BUDGET_BYTES } from "../../core/self/index.js";
import { Store, isWithin, storeExists } from "../../core/store/index.js";
import { CONFIG_ENV, CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
import {
  MODEL_FILE,
  STATIC_WEIGHTS_ENV,
  STATIC_WEIGHTS_PACKAGE,
  resolveStaticWeights
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
  DEFAULT_STORE_DIR
} from "./install.js";
import { NEW_INSTALL_DREAMING_LINE, beginNewInstall } from "../../core/onboarding.js";
import { isPromptAborted, ui, ask } from "./ui.js";
import { tilde, realSpawner, realProcessLister, wire, unwire, sessionsNote, look } from "./wire.js";
import { desktopUnavailable, connectDesktop, repairDesktop } from "./desktop.js";
import { bundledModelDir } from "../runtime.js";
import { DESKTOP_ALWAYS_ALLOW } from "../hosts.js";
import { humanBytes as humanDiskBytes, uninstallJson, uninstall } from "./uninstall.js";
import {
  EXIT,
  openStoreAt,
  prefixedRefusal,
  describeDirRefusal,
  openCounterpart,
  customConfigPath,
  hostConfigFor,
  exitFor
} from "./commands-shared.js";
export function installCommand(parsed, io, env, home, named, opts = {}) {
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  const home_ = home ?? homedir();
  const custom = named !== undefined && named.source !== "default" && resolve(named.path) !== defaultConfigPath(home_) ? named.path : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);
  const refusal = layoutRefusal(layout);
  if (refusal !== null) {
    io.err(refusal);
    return EXIT.refused;
  }
  const throwaway = throwawayDefaultRefusal(layout, env, home_);
  if (throwaway !== null) {
    io.err(throwaway);
    return EXIT.refused;
  }
  if (opts.parkedNotice !== false && !existsSync(layout.base)) {
    const found = parkedSiblings(layout.base, home_);
    if (found.length > 0) {
      io.out(`Memory was set aside beside ${tilde(layout.base, home_)} and is NOT being brought back:`);
      for (const one of found) {
        io.out(`  ${tilde(one.path, home_)}  ${one.refusal === null ? humanDiskBytes(one.bytes) : "(cannot be brought back — run install at a terminal for the reason)"}`);
      }
      io.out("This makes a SECOND, blank store beside it. To bring that one back instead,");
      io.out(`run \`${BIN.cli} install\` at a terminal: it asks first, and moves nothing on its own.`);
      io.out("");
    }
  }
  let budgetBytes;
  const budgetFlag = parsed.flags["budget"];
  if (typeof budgetFlag === "string" && budgetFlag.length > 0) {
    const why = budgetRefusal(budgetFlag);
    if (why !== null) {
      io.err(why);
      return EXIT.refused;
    }
    budgetBytes = Number(budgetFlag);
  } else if (opts.defaultBudget !== false && !existsSync(layout.config)) {
    budgetBytes = DEFAULT_BUDGET_BYTES;
  }
  const name = typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined;
  const force = parsed.flags["force"] === true;
  const embedderOn = parsed.flags["embedder"] === true;
  const embedderOff = parsed.flags["no-embedder"] === true;
  if (embedderOn && embedderOff) {
    io.err("refused: --embedder and --no-embedder were both given. Pick one; nothing was written.");
    return EXIT.usage;
  }
  const embedderSaid = embedderOn ? true : embedderOff ? false : opts.defaultEmbedder === true && !existsSync(layout.config) ? true : undefined;
  const existed = storeExists(layout.store);
  let store;
  try {
    store = openStoreAt({ dir: layout.store });
  } catch (err) {
    io.err(prefixedRefusal(describeDirRefusal(err, layout.store)));
    return EXIT.refused;
  }
  const resolved = store.dir;
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
  let seeded = false;
  if (name !== undefined && name.length > 0) {
    const brain = openCounterpart(resolved, false, { name });
    try {
      seeded = true;
    } finally {
      brain.close();
    }
  }
  const embedderBlock = resolveEmbedderBlock({
    enabled: embedderSaid,
    configPath: layout.config
  });
  const carried = force ? carryForward(layout.config, {
    budget: budgetBytes !== undefined,
    name: name !== undefined && name.length > 0,
    embedder: embedderBlock !== undefined
  }) : {};
  const body = configObject({
    layout,
    ...budgetBytes === undefined ? {} : { budgetBytes },
    ...name === undefined ? {} : { name },
    ...embedderBlock === undefined ? {} : { embedder: embedderBlock },
    carried
  });
  const config = writeOnce(layout.config, `${JSON.stringify(body, null, 2)}
`, { force });
  const say = opts.quiet === true ? (_line) => {} : (line) => {
    io.out(line);
  };
  say(existed ? `Store already present at ${resolved}.` : `Created a store at ${resolved}.`);
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
  if (seeded && opts.nameAlreadySaid !== true) {
    say(`  identity core seeded for ${name ?? ""} — the thing this memory is about.`);
  }
  if (!isWithin(layout.base, resolved)) {
    io.out("");
    io.out(`  --dir moved the STORE only. The configuration stays at ${config.path}:`);
    io.out(custom === undefined ? "  that is the path the hooks read when nothing names another one," : `  and the printed lines below name it with ${CONFIG_FLAG} / ${CONFIG_ENV},`);
    io.out(`  and it points at your store with "dataDir": "${resolved}".`);
  }
  if (config.what === "kept") {
    say("  (an existing file is never rewritten — pass --force to replace it)");
  }
  if (budgetBytes === undefined && opts.defaultBudget === false) {
    say("");
    say(`  NO "injectionBudgetBytes" was written: nobody told us this host's ceiling`);
    say("  and this package invents none (scar §2.18). Re-run with --budget <bytes>,");
    say(`  or add the key to ${config.path}.`);
  }
  if (opts.hostSteps !== false)
    printHostSteps(io, resolved, custom, home_);
  return EXIT.ok;
}
export function carryForward(configPath, supplied) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return {};
  const was = raw;
  const out = {};
  for (const [key, value] of Object.entries(was)) {
    if (key === "dataDir" || key === "owner")
      continue;
    if (key === "credentialsFile" || key === "models" || key === "crashWriteUp" || key === "stopAskShape")
      continue;
    if (key === "injectionBudgetBytes" && supplied.budget)
      continue;
    if (key === "identity" && supplied.name)
      continue;
    if (key === "embedder" && supplied.embedder)
      continue;
    out[key] = value;
  }
  return out;
}
function printHostSteps(io, resolved, custom, home_) {
  io.out("");
  io.out("Two steps left, and they are the HOST'S files, so they are printed, not applied.");
  io.out("Nothing below has been written and no host configuration was read.");
  io.out("");
  io.out("  1. Merge this into ~/.claude/settings.json (one script, five events):");
  io.out("");
  for (const line of settingsBlock(hookCommand(custom)).split(`
`))
    io.out(`     ${line}`);
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
  if (custom !== undefined) {
    io.out(`  Both lines carry this install's configuration, because it is NOT at`);
    io.out(`  ${defaultConfigPath(home_)} — the path all four entry points`);
    io.out(`  read when nobody says otherwise. The hook takes it as ${CONFIG_FLAG} <path>; the`);
    io.out(`  server takes it as ${CONFIG_ENV}, because this host launches MCP servers`);
    io.out("  from a static registration with no command line to write into.");
    io.out("");
  }
  io.out(`  Then restart Claude Code, and check it with: ${BIN.cli} doctor${custom === undefined ? "" : ` --config ${custom}`}`);
  io.out("  An MCP server keeps the code it was launched with: after an upgrade, restart");
  io.out("  every open session or the old server keeps serving.");
  io.out("");
  io.out(`  Or have it done for you: ${BIN.cli} connect`);
}
export function installDesktop(parsed, io, env, home, named, now) {
  const home_ = home ?? homedir();
  const unavailable = desktopUnavailable(process.platform, home_);
  if (unavailable !== null) {
    io.err(unavailable);
    return EXIT.refused;
  }
  const code = installCommand(parsed, io, env, home_, named, { hostSteps: false, defaultBudget: false });
  if (code !== EXIT.ok)
    return code;
  const custom = customConfigPath(named, home_);
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);
  const store = hostConfigFor(layout.config).config.dataDir ?? layout.store;
  const result = connectDesktop({
    home: home_,
    store,
    exe: process.execPath,
    ...custom === undefined ? {} : { configPath: custom },
    now: now()
  });
  io.out("");
  switch (result.outcome) {
    case "already":
      io.out(`Claude Desktop: already connected — ${tilde(result.path, home_)} has this entry, and nothing was changed.`);
      return EXIT.ok;
    case "added":
    case "updated":
      io.out(`Claude Desktop: ${result.outcome === "added" ? "connected" : "entry updated"} in ${tilde(result.path, home_)}.`);
      if (result.previousStore !== undefined && result.previousStore !== null && result.previousStore !== store) {
        io.out(`  It named another store before: ${result.previousStore} — that memory is still there; Desktop now uses ${store}.`);
      }
      if (result.backup !== null)
        io.out(`  backed up first: ${result.backup}`);
      io.out("  Every other server in that file was left as it was.");
      io.out("If Claude Desktop was open while this ran, quit it and run this again — it rewrites its own config file while it runs.");
      io.out('Then open Claude Desktop. In a new chat, ask it to call the counterparts wake tool first (or pick the "Start with Counterparts" prompt where Desktop lists it).');
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
export async function installInteractive(parsed, io, env, opts, named, now) {
  try {
    return await installConversation(parsed, io, env, opts, named, now);
  } catch (err) {
    if (!isPromptAborted(err))
      throw err;
    const home = opts.home ?? homedir();
    const custom = customConfigPath(named, home);
    const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
    const layout = installLayout(dirFlag, env, home, custom);
    const u = ui(io, env);
    u.blank();
    u.fail("stopped; nothing else was changed.");
    u.hint(storeExists(layout.store) ? `Your store is at ${layout.store}.` : "No store was created.");
    if (existsSync(layout.config))
      u.hint(`Its configuration is ${layout.config}.`);
    u.hint(`Run \`${BIN.cli} install\` again whenever you like; it picks up where this left off.`);
    return EXIT.refused;
  }
}
async function installConversation(parsed, io, env, opts, named, now) {
  const home_ = opts.home ?? homedir();
  const u = ui(io, env);
  const custom = customConfigPath(named, home_);
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);
  u.heading(`${BIN.cli} install`);
  u.blank();
  if (await offerParkedMemory(io, u, layout, home_) === "stopped")
    return EXIT.refused;
  const already = storeExists(layout.store);
  const flags = { ...parsed.flags };
  let name = typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined;
  if (already) {
    const known = hostConfigFor(layout.config).config.identity?.name;
    io.out(known === undefined || known.length === 0 ? "Welcome back." : `Welcome back, ${known}.`);
    if (name !== undefined && name.trim().length > 0 && name.trim() !== known) {
      u.hint(known === undefined || known.length === 0 ? `--name was not used: this memory already exists, and a name is only seeded when one is made.` : `--name was not used: this memory is already called ${known}.`);
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
  const zoneSet = hostConfigFor(layout.config).config.timeZone;
  u.hint(zoneSet === undefined ? `Times read in ${resolveZone(undefined)}, this computer's zone — "timeZone" in the config pins another.` : `Times read in ${zoneSet}, as the config's "timeZone" says.`);
  u.blank();
  const suppliedBudget = typeof parsed.flags["budget"] === "string" ? parsed.flags["budget"] : undefined;
  if (suppliedBudget === undefined && !existsSync(layout.config)) {
    flags["budget"] = String(DEFAULT_BUDGET_BYTES);
  }
  const configExisted = existsSync(layout.config);
  const code = installCommand({ command: "install", positional: [], flags }, io, env, home_, named, {
    hostSteps: false,
    nameAlreadySaid: true,
    quiet: true,
    parkedNotice: false,
    defaultEmbedder: true
  });
  if (code !== EXIT.ok)
    return code;
  if (configExisted && parsed.flags["force"] !== true && (parsed.flags["embedder"] === true || parsed.flags["no-embedder"] === true)) {
    u.hint(`${parsed.flags["embedder"] === true ? "--embedder" : "--no-embedder"} was not used: this configuration already exists and is kept. ` + `\`${BIN.cli} install --force ${parsed.flags["embedder"] === true ? "--embedder" : "--no-embedder"}\` rewrites it, keeping every other setting.`);
  }
  const config = hostConfigFor(layout.config).config;
  const store = config.dataDir ?? layout.store;
  const spawner = opts.spawner ?? realSpawner(env);
  const lister = opts.processes ?? realProcessLister(env);
  let wired = null;
  if (!claudeCodeHere(home_, env, spawner)) {
    io.out("Claude Code is not on this machine, so there was nothing to connect.");
    u.hint(`When you have it, run \`${BIN.cli} connect\`.`);
  } else {
    io.out("Connecting Claude Code…");
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
      heading: false
    });
    if (wired.hooks === "declined" || wired.outcome !== "ok") {
      u.hint("Your store is made either way; connecting is the only part not done.");
      u.hint(`You can do it later with: ${BIN.cli} connect`);
    }
  }
  const desktop = repairDesktopEntry(io, env, home_, lister, false, now());
  const desktopPending = desktop.outcome === "desktop-running" || desktop.outcome === "failed";
  const desktopUnread = desktop.outcome === "refused";
  u.blank();
  const bundled = bundledModelDir();
  const table = resolveStaticWeights({ env, ...bundled === undefined ? {} : { packageDir: bundled } });
  const tableOn = config.embedder?.enabled === true;
  const tableMissing = tableOn && (table === null || !existsSync(join(table.dir, MODEL_FILE)));
  if (tableOn && !tableMissing) {
    io.out("Recall by meaning: on. A small model runs on your machine; nothing is sent anywhere.");
    u.blank();
  }
  if (!already) {
    io.out(NEW_INSTALL_DREAMING_LINE);
    u.blank();
  }
  if (tableMissing) {
    u.warn("recall by meaning is on, but its table was not found — recall will match on words only.");
    u.hint(`Install it: bun add -g ${STATIC_WEIGHTS_PACKAGE} — or set ${STATIC_WEIGHTS_ENV} to a folder holding it.`);
    u.blank();
  }
  const memoryAt = isWithin(layout.base, store) ? layout.base : store;
  io.out(`Done. Your memory lives at ${tilde(memoryAt, home_)}.`);
  const hooksIn = wired !== null && (wired.hooks === "wired" || wired.hooks === "repaired" || wired.hooks === "already");
  const toolsIn = wired !== null && (wired.mcp === "added" || wired.mcp === "re-added" || wired.mcp === "already");
  const connected = wired !== null && wired.outcome === "ok" && hooksIn && toolsIn;
  if (connected && !tableMissing && !desktopPending && !desktopUnread) {
    io.out(`Restart Claude Code, then run \`${BIN.cli} doctor\` — it should be all green.`);
  } else if (hooksIn && !toolsIn) {
    io.out("The hooks are in; the memory tools are NOT registered — the line above does that.");
    io.out(`Then restart Claude Code and run \`${BIN.cli} doctor\`.`);
  } else if (connected && desktopUnread) {
    io.out(`Restart Claude Code, then run \`${BIN.cli} doctor\`. Claude Desktop's config was left as it was, as said above; once it is fixed, \`${BIN.cli} connect\` brings its entry up to date.`);
  } else if (connected && !desktopPending) {
    io.out(`Restart Claude Code, then run \`${BIN.cli} doctor\` — everything but recall by meaning should be green.`);
  } else if (connected) {
    io.out(`Restart Claude Code, then run \`${BIN.cli} doctor\` — its Runtime line stays amber until Claude Desktop's entry is rewritten, as said above.`);
  } else {
    io.out(`Run \`${BIN.cli} doctor\` to see where this got to.`);
  }
  return EXIT.ok;
}
function claudeCodeHere(home, env, spawner) {
  if (existsSync(hostSettingsDir(home, env)))
    return true;
  return !spawner(["--version"]).missing;
}
async function offerParkedMemory(io, u, layout, home) {
  if (existsSync(layout.base))
    return "none";
  const found = parkedSiblings(layout.base, home);
  if (found.length === 0)
    return "none";
  for (const one of found) {
    if (one.refusal === null)
      continue;
    u.warn(`${tilde(one.path, home)} cannot be brought back.`);
    u.hint(one.refusal);
  }
  const usable = found.filter((one) => one.refusal === null);
  if (usable.length === 0) {
    u.hint("Nothing here can be brought back, so this is a fresh start.");
    u.blank();
    return "blank";
  }
  let chosen;
  if (usable.length === 1) {
    const one = usable[0];
    const answer = await askOnce(io, u, `Found memory set aside on ${one.date} (${humanDiskBytes(one.bytes)}). Bring it back, or start blank? [back/blank]`, (raw) => raw === "back" || raw === "b" || raw === "1" ? "back" : raw === "blank" ? "blank" : null, "Answer back or blank.");
    if (answer === null)
      return stoppedAtParked(io);
    if (answer === "blank")
      return blankBeside(u, usable, home);
    chosen = one.path;
  } else {
    io.out(`Found ${String(usable.length)} memory folders set aside, newest first:`);
    for (const [i, one] of usable.entries()) {
      io.out(`  ${String(i + 1)}. ${tilde(one.path, home)}  set aside ${one.date}  ${humanDiskBytes(one.bytes)}`);
    }
    const tags = usable.map((_, i) => String(i + 1)).join("/");
    const answer = await askOnce(io, u, `Bring one back, or start blank? [${tags}/blank]`, (raw) => {
      if (raw === "blank")
        return "blank";
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= usable.length ? String(n) : null;
    }, `Answer ${tags.split("/").join(", ")} or blank.`);
    if (answer === null)
      return stoppedAtParked(io);
    if (answer === "blank")
      return blankBeside(u, usable, home);
    chosen = usable[Number(answer) - 1].path;
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
async function askOnce(io, u, question, parse, retry) {
  for (let attempt = 0;attempt < 2; attempt += 1) {
    const raw = (await ask(io, question)).trim().toLowerCase();
    const answer = parse(raw);
    if (answer !== null)
      return answer;
    if (attempt === 0)
      u.hint(retry);
  }
  return null;
}
function stoppedAtParked(io) {
  io.err("Nothing was changed, and the memory set aside is exactly where it was.");
  return "stopped";
}
function blankBeside(u, usable, home) {
  for (const one of usable)
    u.hint(`${tilde(one.path, home)} is untouched, exactly as it was.`);
  u.hint(`It stays there until you move it; \`${BIN.cli} install\` will offer it again.`);
  u.blank();
  return "blank";
}
const DEFAULT_BUDGET_BYTES = PAGE_HOST_BUDGET_BYTES;
export const KNOWN_HOSTS = ["claude-code"];
export async function hostWiringCommand(command, parsed, io, env, opts, named, now) {
  const askedHost = parsed.positional[0];
  if (command !== "uninstall" && askedHost !== undefined && !KNOWN_HOSTS.includes(askedHost)) {
    io.err(`refused: '${command}' does not know a host called '${askedHost}'. The one it knows is ` + `${KNOWN_HOSTS.join(", ")} — and \`${BIN.cli} ${command}\` on its own means that one.`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  if (typeof parsed.flags["dir"] === "string") {
    io.err(`refused: '${command}' takes no --dir. What it acts on is decided by your ` + "CONFIGURATION — that is the file the hooks, the worker and the MCP server read, and a " + `second answer on this command line is how the wrong one gets edited. Name the ` + `configuration instead: ${CONFIG_FLAG} <absolute path>, or ${CONFIG_ENV}.`);
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  const home_ = opts.home ?? homedir();
  const configPath = named === undefined ? defaultConfigPath(home_) : resolve(named.path);
  const custom = customConfigPath(named, home_);
  const present = existsSync(configPath);
  const host = hostConfigFor(configPath);
  if (present && host.reason === "unreadable") {
    io.err(`refused: ${configPath} is there and will not be understood. These commands read ` + '"dataDir" out of it to know which store to name, and a file they cannot read is a ' + "question they will not answer by guessing.");
    io.err("Nothing has changed.");
    return EXIT.refused;
  }
  if (!present && command !== "disconnect") {
    io.err(`refused: there is no configuration at ${configPath}, so there is no install here to ` + `${command === "uninstall" ? "remove" : command}. Run '${BIN.cli} install' first, or name ` + `the configuration you mean with ${CONFIG_FLAG} <absolute path>.` + (command === "connect" ? ` (\`${BIN.cli} disconnect\` does work without one: it only ever takes things out.)` : ""));
    return EXIT.refused;
  }
  const store = host.config.dataDir ?? join(dirname(configPath), DEFAULT_STORE_DIR);
  const spawner = opts.spawner ?? realSpawner(env);
  const lister = opts.processes ?? realProcessLister(env);
  if (command === "uninstall") {
    const uninstallInput = {
      io,
      env,
      home: home_,
      configPath,
      custom,
      config: host.config,
      now: now(),
      yes: parsed.flags["yes"] === true,
      park: parsed.flags["park"] === true,
      deleteMemories: parsed.flags["delete-memories"] === true,
      keepMemories: parsed.flags["keep-memories"] === true,
      nothingIsOpen: parsed.flags["nothing-is-open"] === true,
      exe: process.execPath,
      spawner,
      lister
    };
    return exitFor(parsed.flags["json"] === true ? await uninstallJson(uninstallInput) : await uninstall(uninstallInput));
  }
  const input = {
    io,
    env,
    home: home_,
    configPath,
    custom,
    store,
    now: now(),
    yes: true,
    dryRun: parsed.flags["dry-run"] === true,
    exe: process.execPath,
    spawner,
    lister
  };
  const result = command === "connect" ? await wire(input) : await unwire(input);
  const desktopFailed = command === "connect" && repairDesktopEntry(io, env, home_, lister, input.dryRun === true, now()).outcome === "failed";
  if (command === "connect" && result.outcome === "ok" && (result.hooks !== "already" || result.mcp !== "already")) {
    sessionsNote(ui(io, env), lister, { dataDir: store, env });
  }
  return desktopFailed && result.outcome === "ok" ? EXIT.failed : exitFor(result.outcome);
}
function repairDesktopEntry(io, env, home_, lister, dryRun, at) {
  const sighting = look(lister);
  const repair = repairDesktop({
    home: home_,
    exe: process.execPath,
    desktopRunning: sighting.looked ? sighting.desktopRunning ?? null : null,
    dryRun,
    now: at
  });
  sayDesktopRepair(ui(io, env), repair, home_);
  return repair;
}
function sayDesktopRepair(u, repair, home_) {
  const where = tilde(repair.path, home_);
  switch (repair.outcome) {
    case "none":
    case "current":
      return false;
    case "repaired":
      u.ok(`Claude Desktop: rewrote its counterparts entry to start the memory server the way Claude Code's now does${repair.backup === null ? "" : ` (backup: ${tilde(repair.backup, home_)})`}. It takes effect when Desktop next opens.`);
      return false;
    case "would-repair":
      u.hint(`Claude Desktop: would rewrite its counterparts entry in ${where} to start the memory server the way Claude Code's does. Nothing was written.`);
      return false;
    case "desktop-running":
      u.warn(repair.unknownRunning === true ? `Claude Desktop's counterparts entry was left as it was: whether Desktop is open could not be checked, and Desktop rewrites ${where} while it runs. Quit Claude Desktop, then run \`${BIN.cli} connect\` again.` : `Claude Desktop is open, so its counterparts entry was left in the old shape: Desktop rewrites ${where} while it runs. Quit Claude Desktop, run \`${BIN.cli} connect\` again, then reopen it.`);
      return false;
    case "refused":
      u.warn(`Claude Desktop: ${repair.detail ?? `${where} could not be read, and was left as it was.`}`);
      return false;
    case "failed":
      u.fail(`Claude Desktop's entry could not be rewritten: ${repair.detail ?? "unknown error"}`);
      return true;
  }
}
export function initCommand(dir, io, home = homedir(), name) {
  const existed = storeExists(dir);
  let store;
  try {
    store = openStoreAt({ dir });
  } catch (err) {
    io.err(prefixedRefusal(describeDirRefusal(err, dir)));
    return EXIT.refused;
  }
  const resolved = store.dir;
  store.close();
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
  io.out(seeded ? `  identity core seeded for ${name ?? ""} — the thing this memory is about.` : '  no identity core: pass --name "<your name>" to seed one. Nothing else gives a');
  if (!seeded)
    io.out("  store one, and the wake has nothing to be about without it.");
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
  io.out(`       { "dataDir": "<this dir>", "injectionBudgetBytes": <your host's ceiling> }`);
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
