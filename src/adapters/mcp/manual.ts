/**
 * THE MANUAL (H1, 2026-11-03; Mike approved the lane 11-03 13:01, lightly held).
 *
 * How Counterparts works and how to use it, for the counterpart first and
 * readable by a person: one file, `docs/manual.md`, that ships with every
 * install (package.json `files`, the plugin binary's embedded files, the
 * hosted image), so the manual a counterpart opens is the one for the code it
 * runs on, offline. The web page at counterparts.ai/manual is generated from
 * the same file.
 *
 * The door is `recall`'s handle `manual`: the section index, one line each;
 * and `manual <section>` (the section's heading, any case, or its number):
 * that section whole. No tool of its own, so no session pays for a twelfth
 * description; the handle's description names it in one sentence.
 *
 * The file's shape is the contract: one `# ` title, an intro, then `## `
 * sections, each opening with one plain sentence (the index line). A test
 * (`test/manual.test.ts`) checks every command, flag, tool and handle the
 * file names against the code, so the manual cannot silently go stale.
 */
import { readFileSync } from "node:fs";
import { packagePath } from "../runtime.js";

/** The recall handle that opens the manual. Exact, trimmed, case-folded, like `still open`. */
export const MANUAL_HANDLE = "manual";

/** Where the manual sits in the package, relative to its root. */
export const MANUAL_PATH = "docs/manual.md";

export interface ManualSection {
  /** 1-based, in the file's order. */
  readonly n: number;
  /** The heading as written, after `## `. */
  readonly heading: string;
  /** The handle that opens it: `manual <heading, lower case>`. */
  readonly handle: string;
  /** Its first sentence: the line the index shows. */
  readonly line: string;
  /** The section whole, heading included. */
  readonly text: string;
}

export interface Manual {
  readonly title: string;
  /** What comes before the first section. */
  readonly intro: string;
  readonly sections: readonly ManualSection[];
}

/** Case, punctuation and spacing folded, as `asksStillOpen` folds. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function firstSentence(body: string): string {
  const para = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p.length > 0 && !p.startsWith("```")) ?? "";
  const flat = para.replace(/\s+/g, " ");
  const m = /[.!?](?=\s|$)/.exec(flat);
  return m === null ? flat : flat.slice(0, m.index + 1);
}

/** Read the manual's text into its title, intro and sections. */
export function parseManual(text: string): Manual {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  const intro: string[] = [];
  const raw: { heading: string; body: string[] }[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && line.startsWith("# ") && title === "") {
      title = line.slice(2).trim();
      continue;
    }
    if (!inFence && line.startsWith("## ")) {
      raw.push({ heading: line.slice(3).trim(), body: [] });
      continue;
    }
    if (raw.length === 0) intro.push(line);
    else raw[raw.length - 1]?.body.push(line);
  }
  const sections = raw.map((s, i): ManualSection => {
    const body = s.body.join("\n").trim();
    return {
      n: i + 1,
      heading: s.heading,
      handle: `${MANUAL_HANDLE} ${fold(s.heading)}`,
      line: firstSentence(body),
      text: `## ${s.heading}\n\n${body}`,
    };
  });
  return { title, intro: intro.join("\n").trim(), sections };
}

let cached: { readonly at: string; readonly manual: Manual } | null = null;

/** The installed manual, read once per process; null when the file is missing. */
// The path is written out, not `MANUAL_PATH`: the plugin bundle's trace
// (`tools/plugin-bundle/build.ts#followModule`) carries what `packagePath`
// names by a literal, and a test holds the two equal.
export function installedManual(path: string = packagePath("docs/manual.md")): Manual | null {
  if (cached !== null && cached.at === path) return cached.manual;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  cached = { at: path, manual: parseManual(text) };
  return cached.manual;
}

/**
 * What a recall handle asks of the manual: the index, one section, a section
 * the manual has no such name for (`unknown`), or nothing (not the manual's
 * handle at all).
 */
export type ManualAsk = { readonly kind: "index" } | { readonly kind: "section"; readonly asked: string } | null;

export function manualAsk(handle: unknown): ManualAsk {
  if (typeof handle !== "string") return null;
  const h = fold(handle);
  if (h === MANUAL_HANDLE) return { kind: "index" };
  if (h.startsWith(`${MANUAL_HANDLE} `)) return { kind: "section", asked: h.slice(MANUAL_HANDLE.length + 1) };
  return null;
}

/** The section a handle's words name: its heading (folded) or its number. */
export function findSection(manual: Manual, asked: string): ManualSection | null {
  const a = fold(asked);
  if (/^\d+$/.test(a)) return manual.sections[Number(a) - 1] ?? null;
  return manual.sections.find((s) => fold(s.heading) === a) ?? null;
}

/** The index: the intro, then a line per section with the handle that opens it. */
export function manualIndexText(manual: Manual): string {
  return [
    `# ${manual.title}`,
    "",
    manual.intro,
    "",
    "Sections (open one with recall's handle, as written here):",
    ...manual.sections.map((s) => `- "${s.handle}": ${s.line}`),
  ].join("\n");
}
