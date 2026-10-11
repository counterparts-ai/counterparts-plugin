/**
 * `adapters/cli/` — the owner's console.
 *
 * The dependency direction is one-way and asserted by a test: the core imports
 * NOTHING from this directory, and — the sharper rule — **nothing outside this
 * directory imports `removal.ts`** (§5 G1, §16 G2). `removal.ts` is deliberately
 * NOT re-exported here: a module that is easy to import is a module a future
 * caller imports. The console reaches it directly; nobody else may.
 */
export {
  BINARY_CONNECT_REFUSAL,
  COMMANDS,
  COMMAND_BLURB,
  COMMAND_FLAGS,
  COMMON_FLAGS,
  DASHBOARD_DEFAULT_PORT,
  KNOWN_HOSTS,
  STORE_PREVIOUS_PARKED_KEY,
  STORE_STARTED_BY_KEY,
  STORE_STARTED_KEY,
  commandHelp,
  dashboardLine,
  packageVersion,
  unknownFlag,
  versionLine,
  EXIT,
  OWNER_OPS,
  openCounterpart,
  parse,
  run,
  usage,
} from "./commands.js";
export type { Command, DashboardSeam, Io, RunOptions, RunningView } from "./commands.js";

/**
 * The console's three help pages. `shortHelp` is what `--help`, `help` and a
 * bare invocation print; `advancedHelp` is `counterparts help advanced`;
 * `commandHelp` (above) is one command's own page. The tables are exported so
 * `test/help.test.ts` can walk them against `COMMANDS` in both directions — a
 * command added without help for it, or listed on no page and given no reason,
 * fails there.
 */
export {
  ADVANCED,
  COMMAND_DETAIL,
  CONSOLE_FOOTER,
  GLOBAL_FLAGS,
  GROUPS,
  PENDING_COMMANDS,
  SHORT,
  SHORT_LIMIT,
  UNLISTED,
  advancedHelp,
  linesOf,
  shortHelp,
} from "./help.js";
export type { HelpGroup } from "./help.js";

export { printDoctorReport, printStatusReport } from "./report.js";
export type { StatusBlock, StatusRow, StatusView } from "./report.js";

export {
  BLOB_NAME,
  EXPORT_SCRATCH_STALE_MS,
  sweepStaleExportScratch,
  CIPHER,
  EXPORT_FORMAT,
  KDF,
  decryptBundle,
  encryptBundle,
  exportStore,
} from "./export.js";
export type { ExportMode, ExportOptions, ExportReport } from "./export.js";

export {
  BIN,
  CONFIG_FILE,
  HOOK_SCRIPT,
  HOST_EVENTS,
  MCP_SCRIPT,
  MCP_SERVER_NAME,
  budgetRefusal,
  configObject,
  DEFAULT_STORE_DIR,
  installLayout,
  layoutRefusal,
  tempRoots,
  throwawayDefaultRefusal,
  mcpCommand,
  readHost,
  hostMcpFile,
  hostSettingsFiles,
  hostSettingsDir,
  hostConfigBase,
  runCommand,
  settingsBlock,
  shellQuote,
  writeOnce,
} from "./install.js";
export type { ConfigInput, FileResult, HostRead, InstallLayout, WroteWhat } from "./install.js";

export { assertSafeTarget, snapshot, snapshotName, vacuumInto } from "./snapshot.js";
export type { CopiedEntry, CopyMethod, SnapshotReport } from "./snapshot.js";

export {
  BLANK_INFIX,
  OPEN_WINDOW_MS,
  PARKED_INFIX,
  REAL_OPS,
  configLines,
  confirmationWord,
  guardedMove,
  pairedSuffix,
  park,
  planUndo,
  undoLines,
  parkRefusal,
  parkedPath,
  planLines,
  planStartFresh,
  readLiveness,
  rollbackLines,
  sameFilesystemRefusal,
  sight,
} from "./start-fresh.js";
export type {
  DirSighting,
  Liveness,
  OpenSign,
  ParkOutcome,
  ParkStep,
  PlanInput,
  StartFreshOps,
  StartFreshPlan,
  StartFreshShape,
  UndoPlan,
  UndoStep,
} from "./start-fresh.js";
