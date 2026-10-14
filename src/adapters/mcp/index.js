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
  success
} from "./protocol.js";
export { DESKTOP_TOOLS, TOOLS, TOOL_ALIASES, TOOL_NAMES, WAKE, canonicalToolName, renderDescription, toolDefinitions, toolSpec } from "./tools.js";
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
  provenanceParts
} from "./deliberate.js";
export {
  FACTS_EARLIER_SHOWN,
  FACTS_MEANING_CAP,
  FACTS_PAGE_SIZE,
  FACTS_WEAK_FRACTION,
  factsRecall,
  renderFacts
} from "./facts.js";
export { meaningRecall, renderMeaning } from "./meaning.js";
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
  resolveScope
} from "./server.js";
export { serveStdio } from "./stdio.js";
import { Counterpart } from "../../core/counterpart.js";
import { McpServer } from "./server.js";
function embedOf(embedder) {
  const candidate = embedder?.embed;
  return typeof candidate === "function" ? candidate : undefined;
}
export function openServer(opts = {}) {
  const embed = opts.embed ?? embedOf(opts.embedder);
  const counterpart = Counterpart.open({
    ...embed === undefined ? {} : { embed },
    ...opts.dir === undefined ? {} : { dir: opts.dir },
    ...opts.snapshotsDir === undefined ? {} : { snapshotsDir: opts.snapshotsDir },
    ...opts.timeZone === undefined ? {} : { timeZone: opts.timeZone },
    ...opts.pageWriterMode === undefined ? {} : { pageWriterMode: opts.pageWriterMode },
    ...opts.observer === undefined ? {} : { observer: opts.observer },
    ...opts.owner === undefined ? {} : { owner: opts.owner },
    ...opts.bundlesAsOwner === undefined ? {} : { bundlesAsOwner: opts.bundlesAsOwner },
    ...opts.onCounterpartEvent === undefined ? {} : { onEvent: opts.onCounterpartEvent }
  });
  return new McpServer({
    counterpart,
    ...opts.session === undefined ? {} : { session: opts.session },
    ...opts.scope === undefined ? {} : { scope: opts.scope },
    ...opts.owner === undefined ? {} : { owner: opts.owner },
    ...opts.embedder === undefined ? {} : { embedder: opts.embedder },
    ...opts.registryDir === undefined ? {} : { registryDir: opts.registryDir },
    ...opts.scopesFile === undefined ? {} : { scopesFile: opts.scopesFile },
    ...opts.scopeCommand === undefined ? {} : { scopeCommand: opts.scopeCommand },
    ...opts.install === undefined ? {} : { install: opts.install },
    ...opts.sessionTtlMs === undefined ? {} : { sessionTtlMs: opts.sessionTtlMs },
    ...opts.resultCeilingChars === undefined ? {} : { resultCeilingChars: opts.resultCeilingChars },
    ...opts.host === undefined ? {} : { host: opts.host },
    ...opts.lifecycle === undefined ? {} : { lifecycle: opts.lifecycle },
    ...opts.wakeNotice === undefined ? {} : { wakeNotice: opts.wakeNotice },
    ...opts.manifestVersion === undefined ? {} : { manifestVersion: opts.manifestVersion },
    ...opts.env === undefined ? {} : { env: opts.env },
    ...opts.launchObserver === undefined ? {} : { launchObserver: opts.launchObserver },
    ...opts.ownerFrom === undefined ? {} : { ownerFrom: opts.ownerFrom },
    ...opts.codeTabOwner === undefined ? {} : { codeTabOwner: opts.codeTabOwner },
    ...opts.onEvent === undefined ? {} : { onEvent: opts.onEvent },
    ...opts.afterCall === undefined ? {} : { afterCall: opts.afterCall },
    ...opts.now === undefined ? {} : { now: opts.now }
  });
}
