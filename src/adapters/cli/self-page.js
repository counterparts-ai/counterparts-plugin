import { readFileSync } from "node:fs";
import { PAGE_ROOM_BYTES, PAGE_TEMPLATE, pageRoomNote, pageSections } from "../../core/self/index.js";
export const NO_PAGE_LINES = [
  "No page has been written here yet — still forming.",
  "",
  "A page is written by a woken session (the `self_page` tool), by the nightly",
  "run (its page writer, then its reflection), or by you:",
  "",
  '  counterparts self-page --write --file <path> --reason "why"',
  '  … | counterparts self-page --write --stdin --reason "why"',
  "",
  "A blank page to start from:",
  "",
  ...PAGE_TEMPLATE.trimEnd().split(`
`).map((l) => `  ${l}`),
  "",
  "If a page was written here and cleared, its versions are still listed —",
  "until a new page is written, which then becomes the one this command reads:",
  "  counterparts self-page --versions   ·   counterparts self-page --restore <seq>"
];
export function pageLines(page, stale, versions) {
  const parts = pageSections(page.body);
  const when = page.revisedOn === "" ? "an unrecorded date" : page.revisedOn;
  const head = [
    `Who I am — ${page.bytes} bytes, version ${page.version}, last revised ${when}` + `${page.by === null ? "" : ` by ${page.by}`}${stale ? " — STALE" : ""}.`,
    ...page.reason === null ? [] : [`Last change: ${page.reason}`],
    ...page.bytes <= PAGE_ROOM_BYTES ? [] : [
      page.short === null ? `Past its ${PAGE_ROOM_BYTES}-byte room, with no short version: on a day the wake has no room for it, sessions read each section's heading and first sentence. Add one: ${ADD_SHORT}.` : `Past its ${PAGE_ROOM_BYTES}-byte room, with a ${page.short.bytes}-byte short version written with it: sessions read that on a day the wake has no room for the whole page.`
    ],
    ...versions === 0 ? ["No earlier versions yet."] : [`${versions} earlier version${versions === 1 ? "" : "s"} — 'self-page --versions'.`],
    ...parts.headed ? [`Sections: ${parts.sections.map((s) => s.heading).join(" · ")}.`] : ["(No `##` headings — printed as it stands.)"],
    ""
  ];
  return [...head, ...page.body.split(`
`)];
}
export function versionLines(versions) {
  if (versions.length === 0)
    return ["No earlier versions: the page has been written once, or not at all."];
  return [
    `${versions.length} earlier version${versions.length === 1 ? "" : "s"}, newest first.`,
    "  seq · lived day · size · who wrote it and why · what replaced it",
    "",
    ...versions.map((v) => {
      const size = v.bytes === null ? "unreadable" : `${v.bytes} bytes`;
      const wrote = v.reason === null ? "(unrecorded)" : `${v.by === null ? "" : `${v.by}: `}${v.reason}`;
      return `  ${String(v.seq).padStart(4)}  lived day ${String(v.day).padStart(4)}  ` + `${size.padEnd(12)} ${wrote}   ← replaced by: ${v.replacedBy}`;
    }),
    "",
    "One of them in full: 'self-page --version <seq>'.",
    "Put one back: 'self-page --restore <seq>' — itself a version, itself undoable."
  ];
}
export function bodyFrom(flags, readStdin) {
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
      const code = err.code ?? "";
      return {
        error: `could not read ${from}: ${String(err.message ?? err)}`,
        missing: code === "ENOENT"
      };
    }
  }
  return { body: readStdin() };
}
const ADD_SHORT = "counterparts self-page --write --short <file> (alone, it is added to the page as it stands)";
export function writeLines(written, limit, room = PAGE_ROOM_BYTES) {
  if (!written.written) {
    switch (written.reason) {
      case "observer":
        return {
          lines: ["refused: this console is in observer stance: an instrument reads the page and does not change it."],
          ok: false
        };
      case "too-large":
        return {
          lines: [
            `refused: the page is ${written.bytes} bytes, past the ${limit}-byte write ceiling. Refused rather than cut — what gets cut at write time is the only copy. Say it in ${written.bytes - limit} fewer bytes and write it again.`
          ],
          ok: false
        };
      case "short-not-needed":
      case "short-refused":
        return {
          lines: [`refused: nothing was written. ${pageRoomNote(written, room, ADD_SHORT) ?? "The short version was not kept."}`],
          ok: false
        };
      case "empty":
        return { lines: ["refused: a page has to say something."], ok: false };
      case "forged-markers":
        return {
          lines: [
            "refused: the page carries the wake's own structural markers (`<!-- counterparts:wake`). Those lines are the bundle's bookkeeping; a page that contains them reads, to the next session, as the end of its memory."
          ],
          ok: false
        };
      case "version-moved":
        return {
          lines: [
            `refused: the page has moved on since the version you named — it is at version ${written.current === null ? "?" : written.current.version} now.`,
            "Nothing was written. Read it again ('counterparts self-page'), fold in what you meant to change, and write that."
          ],
          ok: false
        };
      case "no-page":
        return {
          lines: [
            "refused: you named a version, and there is no page here at all — nobody wrote over you. Drop --if-version to write the first one."
          ],
          ok: false
        };
      case "page-appeared":
        return {
          lines: [
            `refused: you wrote as if there were no page, and there is one — version ${written.current === null ? "?" : written.current.version}.`,
            "Nothing was written. Read it first ('counterparts self-page'), then write with that version."
          ],
          ok: false
        };
      case "no-such-version":
        return { lines: ["refused: there is no version by that number."], ok: false };
      default:
        return {
          lines: [
            `refused: the gate battery turned it away${written.gate === null ? "" : ` (${written.gate.gate}: ${written.gate.reason})`}.`
          ],
          ok: false
        };
    }
  }
  if (written.reason === "cleared") {
    return {
      lines: [
        `Cleared the page — the ${written.bytes} bytes that were there are kept as version ${written.version}.`,
        `The wake goes back to what it showed before a page existed. Put it back with: counterparts self-page --restore ${written.version}.`
      ],
      ok: true
    };
  }
  return {
    lines: [
      `${written.reason === "created" ? "Wrote" : "Revised"} the page — ${written.bytes} bytes, version ${written.version}.`,
      ...written.redacted === null ? [] : [
        `NOTE: the gate redacted the page before storing it (${written.redacted.gate}) — ${written.redacted.bytesBefore} bytes in, ${written.bytes} out. Read it back before you rely on it: counterparts self-page.`
      ],
      ...(() => {
        const note = pageRoomNote(written, room, ADD_SHORT);
        return note === null ? [] : [`NOTE: ${note}`];
      })(),
      "It reaches the wake when a turn next ends in any session. To put it there now: counterparts rebrief."
    ],
    ok: true
  };
}
