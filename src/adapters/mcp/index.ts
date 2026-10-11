/**
 * `adapters/mcp/` — the deliberate tools, over the wire.
 *
 * The dependency direction is one-way and asserted by a test: the core imports
 * NOTHING from this directory (CONTRACT §5 G9, constitution line 5). Everything
 * exported here is host-shaped; everything imported from `../../core/` is
 * host-agnostic.
 */
export {
  ERROR_CODES,
  FrameReader,
  JSONRPC_VERSION,
  LATEST_PROTOCOL_VERSION,
  PROTOCOL_VERSIONS,
  encodeMessage,
  failure,
  isNotification,
  negotiateVersion,
  parseLine,
  success,
} from "./protocol.js";
export type { ErrorResponse, Id, ParsedLine, Request, Response, SuccessResponse } from "./protocol.js";

export { DESKTOP_TOOLS, TOOLS, TOOL_ALIASES, TOOL_NAMES, WAKE, canonicalToolName, renderDescription, toolDefinitions, toolSpec } from "./tools.js";
export type { Privilege, ToolName, ToolSpec } from "./tools.js";

export {
  RECALL_BODY_CHARS,
  RECALL_EXCERPT_CHARS,
  RECALL_ID_RESULT_CHARS,
  RECALL_MAX_IDS,
  RECALL_RESULT_CHARS,
  boundById,
  hasFaded,
  deliberateRecall,
  embedQuestion,
  expandHandle,
  expandIds,
  provenanceOf,
  provenanceParts,
} from "./deliberate.js";
export type {
  BoundedMemory,
  BoundedResult,
  DeliberateInput,
  DeliberateOptions,
  DeliberateReason,
  DeliberateResult,
  Recalled,
} from "./deliberate.js";

export {
  FACTS_EARLIER_SHOWN,
  FACTS_MEANING_CAP,
  FACTS_PAGE_SIZE,
  FACTS_WEAK_FRACTION,
  factsRecall,
  renderFacts,
} from "./facts.js";
export type { FactItem, FactsContext, FactsResult, FactsTime, FactWay } from "./facts.js";
export { meaningRecall, renderMeaning } from "./meaning.js";
export type { MeaningContext, MeaningResult } from "./meaning.js";

export {
  DESKTOP_DREAM_NOTE,
  DESKTOP_INSTRUCTIONS,
  McpServer,
  NO_DESKTOP_SESSION,
  OWNER_FALSE_NOTE,
  SEEN_SESSIONS,
  SERVER_NAME,
  SERVER_VERSION,
  START_PROMPT,
  desktopBindNote,
  desktopWriteUpAsk,
  hostScope,
  resolveScope,
} from "./server.js";
export type {
  McpEvent,
  McpServerOptions,
  QuestionEmbedder,
  ScopeSource,
  ToolResult,
} from "./server.js";

export { serveStdio } from "./stdio.js";
export type { StdioOptions } from "./stdio.js";

import { Counterpart } from "../../core/counterpart.js";
import type { CounterpartEvent } from "../../core/counterpart.js";
import type { Embedder } from "../../core/store/index.js";
import { McpServer } from "./server.js";
import type { McpServerOptions } from "./server.js";

export interface OpenServerOptions extends Omit<McpServerOptions, "counterpart"> {
  /** `CounterpartOptions.bundlesAsOwner`: tests only — no host sets it (review of #318). */
  bundlesAsOwner?: boolean;
  /** Where the memory lives. Defaults to the store's own resolution. */
  dir?: string;
  observer?: boolean;
  /**
   * The STORE's sync embedder — the same `Embedder` the hooks hand their store,
   * carrying its identity. Absent, it is taken from `embedder` when that is a
   * full live embedder (the entry point's `openEmbedder` result is one), so the
   * entry point needs no second argument.
   *
   * Why the server's store needs it (review of #190, MAJOR 1; INTERFACE-GAPS
   * §7): a store opened with no identity never reconciles box 3's tag, and this
   * server ranks its `recall` question against box 3. With the identity it
   * reconciles like every hook does — a held or mismatched table answers
   * nothing instead of a cosine across two models — and, under the static
   * table, a memory noted through `note` gets its vector at write time. The
   * paid seat's sync face is a cache, so passing it costs no call.
   */
  embed?: Embedder;
  /** Where the store's pre-migration copy goes — the host config's
   *  `snapshots.dir`, so it lands where rotation and doctor look. */
  snapshotsDir?: string;
  /** The host config's `timeZone` (docs/time.md); absent, the machine's zone. */
  timeZone?: string;
  /** The host config's `pageWriter.mode` — `off` stops the reflection's page
   *  write too (owner ruling D3 on #256). Absent: `session`. */
  pageWriterMode?: "session" | "off";
  /** The brain's own events, for the process log (`adapters/log/`). */
  onCounterpartEvent?: (e: CounterpartEvent) => void;
}

/** The sync face of a live embedder, when `embedder` is one. Duck-typed on purpose: this file must not import the claude-code adapter. */
function embedOf(embedder: OpenServerOptions["embedder"]): Embedder | undefined {
  const candidate = (embedder as { embed?: unknown } | null | undefined)?.embed;
  return typeof candidate === "function" ? (candidate as Embedder) : undefined;
}

/**
 * Open a brain and wrap it in the tools. The host facts — the data dir, whose
 * session this is, which session id the deposits belong to — travel as
 * ARGUMENTS, never as ambient state this file reads for itself (scar §2.13).
 */
export function openServer(opts: OpenServerOptions = {}): McpServer {
  const embed = opts.embed ?? embedOf(opts.embedder);
  const counterpart = Counterpart.open({
    ...(embed === undefined ? {} : { embed }),
    ...(opts.dir === undefined ? {} : { dir: opts.dir }),
    ...(opts.snapshotsDir === undefined ? {} : { snapshotsDir: opts.snapshotsDir }),
    ...(opts.timeZone === undefined ? {} : { timeZone: opts.timeZone }),
    ...(opts.pageWriterMode === undefined ? {} : { pageWriterMode: opts.pageWriterMode }),
    ...(opts.observer === undefined ? {} : { observer: opts.observer }),
    ...(opts.owner === undefined ? {} : { owner: opts.owner }),
    ...(opts.bundlesAsOwner === undefined ? {} : { bundlesAsOwner: opts.bundlesAsOwner }),
    ...(opts.onCounterpartEvent === undefined ? {} : { onEvent: opts.onCounterpartEvent }),
  });
  return new McpServer({
    counterpart,
    ...(opts.session === undefined ? {} : { session: opts.session }),
    ...(opts.scope === undefined ? {} : { scope: opts.scope }),
    ...(opts.owner === undefined ? {} : { owner: opts.owner }),
    // The embedder is the ENTRY POINT's to open: this file composes, it does
    // not read a configuration (server.ts's header).
    ...(opts.embedder === undefined ? {} : { embedder: opts.embedder }),
    ...(opts.registryDir === undefined ? {} : { registryDir: opts.registryDir }),
    ...(opts.scopesFile === undefined ? {} : { scopesFile: opts.scopesFile }),
    ...(opts.scopeCommand === undefined ? {} : { scopeCommand: opts.scopeCommand }),
    ...(opts.sessionTtlMs === undefined ? {} : { sessionTtlMs: opts.sessionTtlMs }),
    ...(opts.resultCeilingChars === undefined ? {} : { resultCeilingChars: opts.resultCeilingChars }),
    // Which host, and what Claude Desktop's `wake` needs (2026-09-30) — carried
    // through unchanged; the server decides what to do with them.
    ...(opts.host === undefined ? {} : { host: opts.host }),
    ...(opts.lifecycle === undefined ? {} : { lifecycle: opts.lifecycle }),
    ...(opts.wakeNotice === undefined ? {} : { wakeNotice: opts.wakeNotice }),
    ...(opts.manifestVersion === undefined ? {} : { manifestVersion: opts.manifestVersion }),
    ...(opts.env === undefined ? {} : { env: opts.env }),
    ...(opts.launchObserver === undefined ? {} : { launchObserver: opts.launchObserver }),
    ...(opts.ownerFrom === undefined ? {} : { ownerFrom: opts.ownerFrom }),
    ...(opts.codeTabOwner === undefined ? {} : { codeTabOwner: opts.codeTabOwner }),
    ...(opts.onEvent === undefined ? {} : { onEvent: opts.onEvent }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
}
