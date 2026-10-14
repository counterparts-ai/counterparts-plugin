export {
  CAPABILITIES,
  TUNABLES,
  capabilities,
  PAGE_WRITER_FALLBACK_MODE,
  loadConfig,
  pageWriterMode
} from "../config.js";
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
  worstFirst
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
  withoutPlain
} from "./hooks.js";
export { openEmbedder } from "./embed-client.js";
export { DEFAULT_HOST_COMMAND, KILL_GRACE_MS, PERMISSION_MODE, REAP_GRACE_MS, startChild } from "./child.js";
export {
  DREAM_CHILD_DENIED,
  DREAM_CHILD_TOOLS,
  HOST_SESSION_ENV,
  NIGHT_KIND_ENV,
  NIGHT_DENIED_TOOLS,
  NIGHT_MCP_SCRIPT,
  NIGHT_MCP_SERVER,
  NIGHT_RUN_ENV,
  NIGHT_TOOLS,
  kindValue,
  nightChildrenTimeoutMs,
  nightMaxTurns,
  nightMcpConfig,
  nightRowTimeoutMs,
  nightTimeoutMs,
  openNightCounterpart,
  planNightChild,
  planNightRunner,
  readKind,
  readNightSpills,
  runNight
} from "./night-run.js";
export { DATA_DIR_ENV, NIGHT_CHILD_ENV, SCOPE_ENV, SESSION_ENV, WATCHDOG_ENV, planSpawn, spawnDetached } from "../spawn.js";
export {
  BACKFILL_LIMIT,
  LAG_PROMPT_BYTES,
  LAG_REPLY_BYTES,
  backfillVectors,
  lagText,
  laggedSemantic
} from "./vectors.js";
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
  parseToolSpills,
  parseTranscript,
  readTranscript,
  readWakeArrival,
  spillOf
} from "./transcript.js";
import { Counterpart } from "../../core/counterpart.js";
import { openEmbedder } from "./embed-client.js";
import { ClaudeCodeAdapter } from "./hooks.js";
export function openAdapter(config, opts = {}) {
  const { embedder: injected, onCounterpartEvent, ...adapterOpts } = opts;
  const embedder = injected !== undefined ? injected : openEmbedder(config);
  const counterpart = Counterpart.open({
    ...embedder === null ? {} : { embed: embedder.embed, vectors: embedder },
    ...config.dataDir === undefined ? {} : { dir: config.dataDir },
    ...config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir },
    ...config.injectionBudgetBytes === undefined ? {} : { budgetBytes: config.injectionBudgetBytes },
    ...config.observer === undefined ? {} : { observer: config.observer },
    ...config.owner === undefined ? {} : { owner: config.owner },
    ...config.timeZone === undefined ? {} : { timeZone: config.timeZone },
    ...config.pageWriter?.mode === undefined ? {} : { pageWriterMode: config.pageWriter.mode },
    ...config.identity === undefined ? {} : { identity: { name: config.identity.name, aliases: [...config.identity.aliases ?? []] } },
    ...onCounterpartEvent === undefined ? {} : { onEvent: onCounterpartEvent }
  });
  return new ClaudeCodeAdapter({ counterpart, config, ...adapterOpts });
}
