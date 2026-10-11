/**
 * `counterparts self-page` — the owner's door to the written page.
 *
 * The page is the prose the wake now leads with, and constitution 6 says the
 * owner owns the data, in prose they can read and hand-edit in any editor. This
 * is the console half of that: read it, write it whole from a file or from
 * stdin, list what it used to say, and print any one of those versions.
 *
 * **Rendering only.** Every rule about the page — the caps, the gate battery,
 * the durable row, the refusals — lives on the one core seam
 * (`core/self/index.ts#revisePage`), and this file decides nothing of its own.
 * A console that re-implemented a cap would be a second cap.
 *
 * **Reading is allowed under observer; writing is not.** The write refuses at
 * the seam, in the sentence every other write refuses in, which is why
 * `self-page` is not on `OWNER_OPS` — see the note there. An instrument must be
 * able to answer "what does the page say", because that is the first question
 * anyone asks when the wake looks wrong.
 */
import { readFileSync } from "node:fs";

import type { Counterpart } from "../../core/counterpart.js";
import { PAGE_ROOM_BYTES, PAGE_TEMPLATE, pageRoomNote, pageSections } from "../../core/self/index.js";
import type { PageVersion, SelfPage } from "../../core/self/index.js";

/** What a read prints when the store holds no page. Honest, and not a page. */
export const NO_PAGE_LINES: readonly string[] = [
  "No page has been written here yet — still forming.",
  "",
  "A page is written by a woken session (the `self_page` tool), by the nightly",
  "run (its page writer, then its reflection), or by you:",
  "",
  "  counterparts self-page --write --file <path> --reason \"why\"",
  "  … | counterparts self-page --write --stdin --reason \"why\"",
  "",
  "A blank page to start from:",
  "",
  ...PAGE_TEMPLATE.trimEnd().split("\n").map((l) => `  ${l}`),
  "",
  "If a page was written here and cleared, its versions are still listed —",
  "until a new page is written, which then becomes the one this command reads:",
  "  counterparts self-page --versions   ·   counterparts self-page --restore <seq>",
];

export function pageLines(page: SelfPage, stale: boolean, versions: number): string[] {
  const parts = pageSections(page.body);
  const when = page.revisedOn === "" ? "an unrecorded date" : page.revisedOn;
  const head = [
    `Who I am — ${page.bytes} bytes, version ${page.version}, last revised ${when}` +
      `${page.by === null ? "" : ` by ${page.by}`}${stale ? " — STALE" : ""}.`,
    ...(page.reason === null ? [] : [`Last change: ${page.reason}`]),
    // ITS ROOM AND ITS SHORT VERSION (2026-10-10): what a session reads on a
    // day the wake has no room for the whole page.
    ...(page.bytes <= PAGE_ROOM_BYTES
      ? []
      : [
          page.short === null
            ? `Past its ${PAGE_ROOM_BYTES}-byte room, with no short version: on a day the wake has no room for it, sessions read each section's heading and first sentence. Add one: ${ADD_SHORT}.`
            : `Past its ${PAGE_ROOM_BYTES}-byte room, with a ${page.short.bytes}-byte short version written with it: sessions read that on a day the wake has no room for the whole page.`,
        ]),
    ...(versions === 0
      ? ["No earlier versions yet."]
      : [`${versions} earlier version${versions === 1 ? "" : "s"} — 'self-page --versions'.`]),
    // ANY heading is a section (2026-09-28): "## Us" and "## How I work" count.
    ...(parts.headed
      ? [`Sections: ${parts.sections.map((s) => s.heading).join(" · ")}.`]
      : ["(No `##` headings — printed as it stands.)"]),
    "",
  ];
  return [...head, ...page.body.split("\n")];
}

/**
 * The version log, labelled by the write that PRODUCED each body.
 *
 * `store.revise` records the REPLACING write's reason on the row it archives, so
 * printing `VersionRow.reason` straight through labelled the first page with the
 * second write's words while the current page's own `Last change:` line was
 * right — the same word meaning opposite things on two surfaces (adversarial
 * review M3). `self/#pageVersions` reads the producing write off the durable
 * rows; this prints it, with the replacing reason named for what it is, and in
 * BYTES like every other page surface rather than in characters (m8).
 */
export function versionLines(versions: readonly PageVersion[]): string[] {
  if (versions.length === 0) return ["No earlier versions: the page has been written once, or not at all."];
  return [
    `${versions.length} earlier version${versions.length === 1 ? "" : "s"}, newest first.`,
    "  seq · lived day · size · who wrote it and why · what replaced it",
    "",
    ...versions.map((v) => {
      const size = v.bytes === null ? "unreadable" : `${v.bytes} bytes`;
      const wrote =
        v.reason === null
          ? "(unrecorded)"
          : `${v.by === null ? "" : `${v.by}: `}${v.reason}`;
      return (
        `  ${String(v.seq).padStart(4)}  lived day ${String(v.day).padStart(4)}  ` +
        `${size.padEnd(12)} ${wrote}   ← replaced by: ${v.replacedBy}`
      );
    }),
    "",
    "One of them in full: 'self-page --version <seq>'.",
    "Put one back: 'self-page --restore <seq>' — itself a version, itself undoable.",
  ];
}

/** The body a write is given: a file, or standard input. Never a flag value —
 *  a page on the command line is a page in shell history. */
export function bodyFrom(
  flags: { file?: string | boolean | undefined; stdin?: string | boolean | undefined },
  readStdin: () => string,
): { body: string } | { error: string; missing?: boolean } {
  const from = typeof flags.file === "string" ? flags.file : null;
  const stdin = flags.stdin === true || typeof flags.stdin === "string";
  if (from !== null && stdin) {
    return { error: "--file and --stdin both name where the page comes from; pass one." };
  }
  if (from === null && !stdin) {
    return { error: "--write needs the page: --file <path>, or --stdin." };
  }
  if (from !== null) {
    try {
      return { body: readFileSync(from, "utf8") };
    } catch (err) {
      // A file that is not THERE is a command line that is wrong; a file that is
      // there and will not open is the machine failing. `EXIT.failed` exists for
      // the second, and the caller reads `missing` to tell them apart (n5).
      const code = (err as NodeJS.ErrnoException).code ?? "";
      return {
        error: `could not read ${from}: ${String((err as Error).message ?? err)}`,
        missing: code === "ENOENT",
      };
    }
  }
  return { body: readStdin() };
}

export interface WrittenLines {
  readonly lines: string[];
  readonly ok: boolean;
}

/** How the console adds a short version, in the words `pageRoomNote` ends with. */
const ADD_SHORT = "counterparts self-page --write --short <file> (alone, it is added to the page as it stands)";

/** What the console says about a write, accepted or not. `limit` is the
 *  page's write ceiling in bytes (`PAGE_MAX_BYTES`), named in a refusal so the
 *  owner knows how much shorter to make it; `room` the page's room
 *  (`PAGE_ROOM_BYTES`, 2026-10-10), named when the page is past it. */
export function writeLines(
  written: ReturnType<Counterpart["revisePage"]>,
  limit: number,
  room: number = PAGE_ROOM_BYTES,
): WrittenLines {
  if (!written.written) {
    switch (written.reason) {
      case "observer":
        return {
          lines: ["refused: this console is in observer stance: an instrument reads the page and does not change it."],
          ok: false,
        };
      case "too-large":
        return {
          lines: [
            `refused: the page is ${written.bytes} bytes, past the ${limit}-byte write ceiling. Refused rather than cut — what gets cut at write time is the only copy. Say it in ${written.bytes - limit} fewer bytes and write it again.`,
          ],
          ok: false,
        };
      case "short-not-needed":
      case "short-refused":
        return {
          lines: [`refused: nothing was written. ${pageRoomNote(written, room, ADD_SHORT) ?? "The short version was not kept."}`],
          ok: false,
        };
      case "empty":
        return { lines: ["refused: a page has to say something."], ok: false };
      case "forged-markers":
        return {
          lines: [
            "refused: the page carries the wake's own structural markers (`<!-- counterparts:wake`). Those lines are the bundle's bookkeeping; a page that contains them reads, to the next session, as the end of its memory.",
          ],
          ok: false,
        };
      case "version-moved":
        return {
          lines: [
            `refused: the page has moved on since the version you named — it is at version ${written.current === null ? "?" : written.current.version} now.`,
            "Nothing was written. Read it again ('counterparts self-page'), fold in what you meant to change, and write that.",
          ],
          ok: false,
        };
      case "no-page":
        return {
          lines: [
            "refused: you named a version, and there is no page here at all — nobody wrote over you. Drop --if-version to write the first one.",
          ],
          ok: false,
        };
      case "page-appeared":
        return {
          lines: [
            `refused: you wrote as if there were no page, and there is one — version ${written.current === null ? "?" : written.current.version}.`,
            "Nothing was written. Read it first ('counterparts self-page'), then write with that version.",
          ],
          ok: false,
        };
      case "no-such-version":
        return { lines: ["refused: there is no version by that number."], ok: false };
      default:
        return {
          lines: [
            `refused: the gate battery turned it away${written.gate === null ? "" : ` (${written.gate.gate}: ${written.gate.reason})`}.`,
          ],
          ok: false,
        };
    }
  }
  if (written.reason === "cleared") {
    return {
      lines: [
        `Cleared the page — the ${written.bytes} bytes that were there are kept as version ${written.version}.`,
        // TRUE NOW: the clear is a revision of the same row, so the history is
        // this row's for good and a restore revises it back. The first design
        // archived the row and the restore minted a fresh one, which orphaned
        // the very versions this line was promising.
        `The wake goes back to what it showed before a page existed. Put it back with: counterparts self-page --restore ${written.version}.`,
      ],
      ok: true,
    };
  }
  return {
    lines: [
      `${written.reason === "created" ? "Wrote" : "Revised"} the page — ${written.bytes} bytes, version ${written.version}.`,
      // THE GATE CHANGED IT, and the owner is told (adversarial review m1). He
      // wrote a file from his editor; what is stored is not that file, and this
      // is the one row read aloud at the start of every session.
      ...(written.redacted === null
        ? []
        : [
            `NOTE: the gate redacted the page before storing it (${written.redacted.gate}) — ${written.redacted.bytesBefore} bytes in, ${written.bytes} out. Read it back before you rely on it: counterparts self-page.`,
          ]),
      // PAST ITS ROOM, SAID (2026-10-10): kept whole, and what sessions read
      // on a day the wake cannot hold it.
      ...((): string[] => {
        const note = pageRoomNote(written, room, ADD_SHORT);
        return note === null ? [] : [`NOTE: ${note}`];
      })(),
      // The write marks the wake behind (2026-09-30, `self/behind.ts`), and
      // the worker the next turn's end starts re-renders it. With no session
      // running, `rebrief` is the lever.
      "It reaches the wake when a turn next ends in any session. To put it there now: counterparts rebrief.",
    ],
    ok: true,
  };
}
