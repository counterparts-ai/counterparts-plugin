/**
 * `adapters/claude-code/` — the launch adapter's public surface.
 *
 * The dependency direction is one-way and asserted by a test: the core imports
 * NOTHING from this directory (CONTRACT §5 G1, constitution line 5). Everything
 * this file exports is host-shaped; everything it imports from `../../core/` is
 * host-agnostic.
 */
export {
  CAPABILITIES,
  TUNABLES,
  capabilities,
  PAGE_WRITER_FALLBACK_MODE,
  loadConfig,
  pageWriterMode,
} from "../config.js";
export type { AdapterConfig, CapabilityName, CapabilityReport, LoadedConfig } from "../config.js";

export {
  AUTHORSHIP_DAYS,
  CHECKOUT_BUDGET_MS,
  CHECKOUT_TIMEOUT_MS,
  NOTICE_MAX_CHARS,
  NOTICE_TAIL,
  SESSION_NOTICE_BUDGET_MS,
  SEVERITIES,
  anyRed,
  checkoutIsGraded,
  doctorFindings,
  noticeMessage,
  pageWriterFindings,
  readCheckout,
  RESTORE_STEPS,
  readCounterpartOpen,
  reportJson,
  reportLines,
  worstFirst,
} from "./doctor.js";
export type {
  CheckoutReading,
  DoctorInput,
  Finding,
  GitRunner,
  OpenReading,
  Severity,
} from "./doctor.js";

export {
  stopAsk,
  scopeAsk,
  BOUNDARY_KIND,
  ClaudeCodeAdapter,
  HOOKS,
  PAGE_WRITER_TOOL,
  SCOPE_ASK_OPEN,
  SESSION_ENDING,
  SPAWN_REFUSAL_PREFIX,
  SPAWN_START_COUNT_KEY,
  SPAWN_START_DATE_KEY,
  plainContextLine,
  plainLine,
  substanceOf,
  wakeOutcome,
  withoutPlain,
} from "./hooks.js";
export type {
  AdapterEvent,
  AdapterOptions,
  HookInput,
  HookName,
  HookResult,
  HostTurn,
  SessionEndingHook,
  WakeOutcome,
} from "./hooks.js";

export { openEmbedder } from "./embed-client.js";
export type { ChunkFailure, EmbedderStats, LiveEmbedder } from "./embed-client.js";

export { DEFAULT_HOST_COMMAND, KILL_GRACE_MS, PERMISSION_MODE, REAP_GRACE_MS, startChild } from "./child.js";
export type { ChildPlan, ChildResult } from "./child.js";
export {
  HOST_SESSION_ENV,
  NIGHT_KIND_ENV,
  NIGHT_DENIED_TOOLS,
  NIGHT_MCP_SCRIPT,
  NIGHT_MCP_SERVER,
  NIGHT_RUN_ENV,
  NIGHT_TOOLS,
  kindValue,
  nightMaxTurns,
  nightMcpConfig,
  nightTimeoutMs,
  openNightCounterpart,
  planNightChild,
  planNightRunner,
  readKind,
  readNightSpills,
  runNight,
} from "./night-run.js";
export type { NightChildPlan, NightKind, NightRunInput, NightRunnerPlan, NightStarter } from "./night-run.js";

export { DATA_DIR_ENV, SCOPE_ENV, SESSION_ENV, WATCHDOG_ENV, planSpawn, spawnDetached } from "../spawn.js";
export type { PlanInput, SpawnOutcome, SpawnPlan, SpawnRefusal, Spawner } from "../spawn.js";

export {
  BACKFILL_LIMIT,
  LAG_PROMPT_BYTES,
  LAG_REPLY_BYTES,
  backfillVectors,
  lagText,
  laggedSemantic,
} from "./vectors.js";
export type { BackfillReport, LagReport } from "./vectors.js";

export {
  COUNTERPARTS_HOOK_COMMAND,
  COUNTERPARTS_TOOL,
  FOREIGN_MARKERS,
  NO_ARRIVAL,
  SPILL_MAX_BYTES,
  WAKE_HEAD_MAX_BYTES,
  WAKE_HEAD_MAX_LINES,
  attributePeers,
  classifyBlock,
  hostConfigDir,
  hostTranscriptPath,
  parseToolSpills,
  parseTranscript,
  readToolSpills,
  readTranscript,
  readWakeArrival,
  spillOf,
} from "./transcript.js";
export type {
  PeerAttribution,
  SentinelSighting,
  Spill,
  SpillShape,
  ToolSpills,
  TranscriptRead,
  WakeArrival,
} from "./transcript.js";

export { AB_DIR_ENV, V2_OVERRIDE, abDir, assignmentHealth, assignmentPath, primacy, readAssignment } from "./primacy.js";
export type { Assignment, AssignmentHealth, AssignmentState, Primacy, PrimacyReason } from "./primacy.js";

import { Counterpart } from "../../core/counterpart.js";
import type { CounterpartEvent } from "../../core/counterpart.js";
import type { AdapterConfig } from "../config.js";
import { openEmbedder } from "./embed-client.js";
import type { LiveEmbedder } from "./embed-client.js";
import { ClaudeCodeAdapter } from "./hooks.js";
import type { AdapterOptions } from "./hooks.js";

/**
 * Open a brain for this host and wrap it in the hooks.
 *
 * The two host facts travel as ARGUMENTS, which is the whole charter: the
 * injection ceiling the host reported becomes the core's `budgetBytes`, and the
 * data directory is the one the configuration names — never one inherited from
 * an ambient environment variable a caller happened to export (scar §2.13).
 */
export function openAdapter(
  config: AdapterConfig,
  opts: Omit<AdapterOptions, "counterpart" | "config"> & {
    /** Injected so a test can supply vectors without the weights. */
    embedder?: LiveEmbedder | null;
    /** The brain's own events, for the process log (`adapters/log/`). */
    onCounterpartEvent?: (e: CounterpartEvent) => void;
  } = {},
): ClaudeCodeAdapter {
  const { embedder: injected, onCounterpartEvent, ...adapterOpts } = opts;
  const embedder = injected !== undefined ? injected : openEmbedder(config);
  const counterpart = Counterpart.open({
    // Both halves of the same embedder: the SYNC face the store's index holds,
    // and the LIVE face the novelty seam and the sweep's warm call use.
    ...(embedder === null ? {} : { embed: embedder.embed, vectors: embedder }),
    ...(config.dataDir === undefined ? {} : { dir: config.dataDir }),
    ...(config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir }),
    ...(config.injectionBudgetBytes === undefined
      ? {}
      : { budgetBytes: config.injectionBudgetBytes }),
    ...(config.observer === undefined ? {} : { observer: config.observer }),
    ...(config.owner === undefined ? {} : { owner: config.owner }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    // Owner ruling D3 on #256: `pageWriter.mode: off` stops the reflection's page write too.
    ...(config.pageWriter?.mode === undefined ? {} : { pageWriterMode: config.pageWriter.mode }),
    ...(config.identity === undefined
      ? {}
      : { identity: { name: config.identity.name, aliases: [...(config.identity.aliases ?? [])] } }),
    ...(onCounterpartEvent === undefined ? {} : { onEvent: onCounterpartEvent }),
  });
  return new ClaudeCodeAdapter({ counterpart, config, ...adapterOpts });
}
