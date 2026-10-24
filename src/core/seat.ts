/**
 * THE SEAT (2026-10-20, the roadmap's wave 1): whoever answers the memory's
 * own asks — the model that writes up a session it missed, dreams, and
 * reflects. Until now the night bound that to Claude Code (`claude -p`); the
 * self is authored by whoever sits in the seat, so the seat is a protocol the
 * owner's memory names, not a feature of one host (constitution, line 5).
 *
 * One interface: `Seat.answer(ask) → answer`. The ASK is what the memory
 * decided — which act, the words it composed, the tools the answer goes
 * through and the ones it must not reach, whose session it answers for, and
 * its limits. The ANSWER is what the seat saw: whether it took the ask, and
 * how it ended. What the act DID is never read from the answer: it is read
 * from the store, where the tools wrote it (a dream journaled, a write-up
 * deposited, a reflection finished).
 *
 * The acts and their shapes, in one page: `docs/seat.md`.
 *
 * Claude Code's is the one implementation today (`adapters/claude-code/
 * night-run.ts#claudeCodeSeat`, a `claude -p` child with the counterparts MCP
 * server, what every user has); the harness's (`tools/harness/`, dev-only) is
 * the next. No version field and no compatibility apparatus until a third
 * implementer exists.
 */
import { SELF_TUNABLES } from "./self/tunables.js";

/** What is asked: a write-up owed from a session that ended unwritten, the night's dream (with the page writer's phase), the reflection, or the night's tagging (wave 2 lane B, 2026-10-21). */
export type SeatAct = "catch-up" | "writer" | "dream" | "reflection" | "tags";

/** The memory's tools an answer goes through, by the memory's own names (a host prefixes them as it names tools). */
export type SeatTool = "session_end" | "dream" | "reflect" | "self_page" | "recall";

/**
 * WHICH TOOLS EACH ACT ANSWERS THROUGH, and which it must not reach. The
 * dream's answer may not reflect: the reflection is its own ask, with a fresh
 * context that reads tonight's dream from the store, never the dream's
 * conversation (2026-10-11). A write-up deposits; nothing else.
 */
export const SEAT_TOOLS: Readonly<Record<SeatAct, { readonly tools: readonly SeatTool[]; readonly withhold: readonly SeatTool[] }>> = {
  "catch-up": { tools: ["session_end"], withhold: [] },
  // The page writer in a child of its own, first (2026-10-23, `self.PAGE_SPLIT`):
  // the dream tool's `writer` phase and the page, nothing else.
  writer: { tools: ["dream", "self_page"], withhold: ["reflect"] },
  dream: { tools: ["dream", "self_page", "recall"], withhold: ["reflect"] },
  reflection: { tools: ["dream", "reflect", "self_page", "recall"], withhold: [] },
  // The tagging child answers through the dream tool's `tags` phase alone (`dream/tags.ts`).
  tags: { tools: ["dream"], withhold: ["reflect", "self_page"] },
};

/**
 * One ask. `withhold` is declared here and enforced by the host: Claude Code
 * denies those tools to the child, and tells the memory's server which act it
 * serves (`COUNTERPARTS_NIGHT_CHILD` on the server's environment), so the
 * dream tool's last step stops at the journal instead of pointing on to the
 * reflection. A seat that answers through the server another way must tell it
 * the same.
 */
export interface SeatAsk {
  readonly act: SeatAct;
  /** The words the memory composed for this act: the launch prompt. */
  readonly prompt: string;
  readonly tools: readonly SeatTool[];
  readonly withhold: readonly SeatTool[];
  /** The run this ask belongs to (`nrn_…`, `cup_…`). */
  readonly run: string;
  /** The session the answer is filed under: the launching session, or a catch-up's runner. */
  readonly session: string;
  /** The directory the answer is scoped to. */
  readonly scope: string;
  /** Bounds the memory sets on this act; absent, the seat's own defaults. */
  readonly limits?: { readonly turns?: number; readonly ms?: number };
}

export interface SeatAnswer {
  /** The seat would not take the ask, and why; nothing was started. Null when it was taken. */
  readonly refused: string | null;
  /** The seat got as far as starting to answer. */
  readonly started: boolean;
  /** How it ended: an exit code where the seat has one, else null. */
  readonly code: number | null;
  /** Stopped by its watchdog. */
  readonly timedOut: boolean;
  /** What went wrong, in the seat's words, when something did. */
  readonly error: string | null;
  readonly ms: number;
}

export interface Seat<A extends SeatAnswer = SeatAnswer> {
  /** Who sits in it (`claude-code`, `harness:recorded`, …): for logs and measurements, not yet written on the night's row. */
  readonly name: string;
  answer(ask: SeatAsk): Promise<A>;
}

/**
 * THE DREAM WITHOUT THE PAGE (2026-10-23, `self.PAGE_SPLIT`, read at use): with
 * the page writer in a child of its own, the dream's child neither writes the
 * page nor is offered the tool. Off: `SEAT_TOOLS` as it stands.
 */
export const SPLIT_DREAM_TOOLS: { readonly tools: readonly SeatTool[]; readonly withhold: readonly SeatTool[] } = { tools: ["dream", "recall"], withhold: ["reflect", "self_page"] };

/**
 * THE REFLECTION WITHOUT THE PAGE TOOL (2026-10-23, review of #603): while
 * split, it writes "## Core" through its finish (held to its lane); a
 * `self_page` write from its child was a session's, whole-page and unheld.
 */
export const SPLIT_REFLECTION_TOOLS: { readonly tools: readonly SeatTool[]; readonly withhold: readonly SeatTool[] } = { tools: ["dream", "reflect", "recall"], withhold: ["self_page"] };

/**
 * DAY'S END WITH RECALL (2026-10-23, `self.DAYS_END_INPUT`, read at use): it
 * reads the day's chapters by their summaries, and recall opens one whole by
 * its address, as the dream's does since the lean bundles.
 */
export const DAYS_END_TOOLS: { readonly tools: readonly SeatTool[]; readonly withhold: readonly SeatTool[] } = { tools: ["dream", "self_page", "recall"], withhold: ["reflect"] };

/** An act's tools tonight: `SEAT_TOOLS`, with the dream's and the reflection's without the page tool while the page is split, and day's end with recall while it reads the day as told. */
export function seatTools(act: SeatAct): { readonly tools: readonly SeatTool[]; readonly withhold: readonly SeatTool[] } {
  if (act === "writer" && SELF_TUNABLES.DAYS_END_INPUT) return DAYS_END_TOOLS;
  if (!SELF_TUNABLES.PAGE_SPLIT) return SEAT_TOOLS[act];
  return act === "dream" ? SPLIT_DREAM_TOOLS : act === "reflection" ? SPLIT_REFLECTION_TOOLS : SEAT_TOOLS[act];
}

/** An ask for an act, its tools from `seatTools`. */
export function seatAsk(
  act: SeatAct,
  fields: { readonly prompt: string; readonly run: string; readonly session: string; readonly scope: string; readonly limits?: SeatAsk["limits"] },
): SeatAsk {
  const t = seatTools(act);
  return { act, tools: t.tools, withhold: t.withhold, ...fields };
}
