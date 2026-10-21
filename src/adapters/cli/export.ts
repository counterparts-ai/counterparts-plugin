/**
 * `export` — the only way memory leaves this machine, and it leaves by hand.
 *
 * The property is **no silent egress** (contract §4, owner rescope 2): the core
 * has no egress path at all, and this command is an explicit owner action. That
 * makes export the one place the constitution's line 6 — "data leaves the
 * machine only by the owner's explicit choice, encrypted, owner-keyed" — is
 * either honored or quietly broken.
 *
 * **So there is no default.** `--passphrase` encrypts; `--plaintext` is the
 * loud, deliberate opt-out for the ordinary case of copying a store to another
 * directory on the same disk. Neither flag is a REFUSAL, not a guess. An export
 * that silently wrote plaintext because nobody said otherwise is exactly the
 * shape of accident line 6 exists to prevent.
 *
 * Contract §7 OQ1 — "does export encrypt to a key the owner already has, or does
 * it mint one?" — is answered PROVISIONALLY here as: the owner supplies a
 * passphrase, and nothing is minted. Minting is friendlier and is also how an
 * owner ends up with a backup they cannot open. Recorded in NOTES.md as an open
 * owner call, not as a settled one.
 *
 * Crypto is `node:crypto` only: scrypt for the KDF, AES-256-GCM for the payload.
 * No dependency, and the format is documented in the plaintext README written
 * beside the blob — an encrypted archive whose format is undocumented is a
 * different way of losing the data.
 */
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, relative } from "node:path";

import {
  DATABASE_FILE,
  paths,
  renderMarkdown,
  rowTombstoned,
} from "../../core/store/index.js";
import type { DreamRow, MemoryRow, ProseDoc, ReflectionRow, Store } from "../../core/store/index.js";
import { isSelfPageRow } from "../../core/self/page.js";
import { UNDATED, journalRelativePath } from "../../core/self/journal-file.js";
import { SHARE_STATE_WORDS, dreamChangeWords, memoryWords, parseIdList } from "./dream-core.js";
import { assertSafeTarget, vacuumInto } from "./snapshot.js";

/** The KDF's cost parameters travel WITH the blob: a hardcoded N is a format
 *  that cannot be strengthened without orphaning every existing export. */
export const KDF = { N: 16384, r: 8, p: 1, keyBytes: 32, saltBytes: 16 } as const;
export const CIPHER = "aes-256-gcm";
export const EXPORT_FORMAT = "counterparts-export-1";
export const BLOB_NAME = "counterparts-export.cpx";

export type ExportMode = "plaintext" | "encrypted";

/**
 * WHAT KIND OF COPY. `database` is the whole store as one SQLite file — exact,
 * complete, and openable by anything that speaks SQLite. `markdown` is the
 * readable tree: one `.md` per memory, the journal as it stands, the self page
 * as its own file, and one per dream and per reflection (2026-10-09). They are
 * different promises and neither replaces the other, which is why the report
 * names which one ran.
 */
export type ExportKind = "database" | "markdown";

export interface ExportOptions {
  target: string;
  /** Present ⇒ encrypted. Absent AND `plaintext` false ⇒ refusal. */
  passphrase?: string;
  /** The loud opt-out. */
  plaintext?: boolean;
  /** `--markdown`: the readable tree instead of the database file. */
  markdown?: boolean;
  /**
   * @deprecated Ignored since 2026-10-21: nothing is held back as confidential
   * any more. Accepted for one release so scripts keep working; then removed.
   */
  includeConfidential?: boolean;
  /** `--with-versions` on the console: every archived wording as its own file.
   *  Markdown only. */
  versions?: boolean;
  /** `--into-non-empty`: write into a directory that already holds something. */
  intoNonEmpty?: boolean;
  /** `--overwrite`: replace files this export's own paths collide with. Without
   *  it a collision is a REFUSAL — the flag that says "I know this directory has
   *  things in it" is not the same as "replace them without telling me". */
  overwrite?: boolean;
}

export interface ExportReport {
  readonly ok: boolean;
  readonly mode: ExportMode | "refused";
  readonly kind: ExportKind;
  readonly target: string;
  readonly files: number;
  readonly bytes: number;
  readonly reason: string;
  /** Live memory-bearing rows written. Zero for a database export, which
   *  carries them all without counting them. */
  readonly rows: number;
  /** @deprecated Always 0 since 2026-10-21 (nothing is left out as
   *  confidential); kept for one release with `--include-confidential`. */
  readonly omittedConfidential: number;
  /** Ids whose markdown could not be rendered — named, never silently absent. */
  readonly notRendered: readonly string[];
  /** Dreams and reflections written (markdown only; zero for a database
   *  export, which carries both tables whole). Never counted in `rows`. */
  readonly dreams: number;
  readonly reflections: number;
  /** @deprecated Always 0 since 2026-10-21; kept for one release. */
  readonly omittedDreams: number;
  /** @deprecated Always 0 since 2026-10-21; kept for one release. */
  readonly omittedReflections: number;
}

/** path (relative, portable) -> file bytes. */
type Bundle = Map<string, Buffer>;

/**
 * THE BUNDLE IS THE DATABASE.
 *
 * It used to be the database plus a walk of `prose/**.md`, because that is where
 * the memories were. Since the floor (schema v6) the bodies, their archived
 * versions and their metadata are rows, so the one file IS the export and the
 * walk had nothing left to find. That makes the §2.11 rule the whole of this
 * function rather than a footnote on it: the copy goes through `VACUUM INTO`,
 * which is SQLite's own consistent-snapshot path, and never a file copy of a
 * live database — doubly so now that a torn copy would lose the words and not
 * just the bookkeeping.
 *
 * `--markdown`, `journal/` and `spans/` are F7's; this phase owns the deletion
 * of the prose walk and the move of the scratch file, nothing more.
 */
function collect(store: Store, tmpDb: string): Bundle {
  const bundle: Bundle = new Map();
  const copied = vacuumInto(paths.operational(store.dir), tmpDb);
  if (copied.ok) bundle.set(DATABASE_FILE, readFileSync(tmpDb));
  return bundle;
}

/** What a markdown walk found, beside the files it produced. */
interface MarkdownCensus {
  readonly rows: number;
  readonly notRendered: string[];
  readonly journal: number;
  readonly versions: number;
  /** True when the store HOLDS a self page. */
  readonly page: boolean;
  /** Live rows that are ARCHIVED — faded, superseded or merged. Exported, and
   *  counted so the manifest can say so. */
  readonly archived: number;
  /** Dreams and reflections written — a unit said apart from rows. */
  readonly dreams: number;
  readonly reflections: number;
}

/**
 * THE READABLE TREE (F7, owner ruling 4 of 2026-09-18).
 *
 * The database export above is exact and complete and can be opened by anything
 * that speaks SQLite. This is the other promise — constitution line 6's "prose
 * the owner can view" — and it is built from the ROWS, never from a walk of
 * `<store>/journal/`:
 *
 *   - the journal copy on disk is derived, and a stale one (a file whose episode
 *     was removed while the copy could not be written) would be exported as
 *     though it were live. Reading the rows cannot do that.
 *   - it is the SAME renderer and the SAME path function the copy uses, so the
 *     bytes are identical either way. "Included as is" is kept by using the copy's
 *     own code, not by copying its files.
 *
 * Grouped **by kind** — `memories/fact/`, `memories/person/`, … — because kind is
 * the axis the owner already sees in `status` and in the dashboard, it is a
 * closed set of six, and it does not change when a memory is revised. By month
 * was the alternative and it splits one belief's life across directories.
 *
 * **Filenames are ids.** Never titles: a title can be as sensitive as a body,
 * and a directory listing is the one part of an export that gets read over
 * somebody's shoulder.
 *
 * Every live row is in it (the confidential omission was retired 2026-10-21).
 * A removed (tombstoned) row is never exported at all; it has no words left to
 * export and its id is on the deny-list.
 *
 * **ARCHIVED rows ARE exported**, and the manifest says how many. A memory that
 * faded, was superseded or was merged is still the owner's own words, and an
 * export that quietly dropped them would be a copy he could not tell was
 * partial. They are NOT marked file by file: the frontmatter is
 * `renderMarkdown`'s, which carries the payload the row holds and not its
 * physics, and that renderer is shared with the journal copy. A count in the
 * manifest is the honest version of what this export knows.
 *
 * **DREAMS AND REFLECTIONS ARE IN IT TOO** (2026-10-09), one file each under
 * `dreams/` and `reflections/`, laid out like the journal. They are not
 * memories — a dream's journal is kept out of `memories` on purpose, so it is
 * never mistaken for something lived — so they are rendered here, not by
 * `renderMarkdown`, and their front matter carries no `payload:` line.
 */
function collectMarkdown(store: Store, opts: ExportOptions): { bundle: Bundle; census: MarkdownCensus } {
  const bundle: Bundle = new Map();
  const census: MarkdownCensus = {
    rows: 0,
    notRendered: [],
    journal: 0,
    versions: 0,
    page: false,
    archived: 0,
    dreams: 0,
    reflections: 0,
  };
  const counts = census as {
    rows: number;
    notRendered: string[];
    journal: number;
    versions: number;
    page: boolean;
    archived: number;
    dreams: number;
    reflections: number;
  };
  const denied = new Set(store.deniedIds());

  const put = (path: string, text: string): void => {
    bundle.set(path, Buffer.from(text, "utf8"));
  };

  const render = (id: string, doc: ProseDoc): string | null => {
    try {
      return renderMarkdown(doc);
    } catch {
      // The id, never the reason's detail: a render refusal can name a title.
      counts.notRendered.push(id);
      return null;
    }
  };

  for (const id of store.list()) {
    if (denied.has(id)) continue;
    const row = store.row(id);
    if (row === undefined || rowTombstoned(row)) continue;
    if (row.type === "schema" && isSelfPageRow(store, id)) counts.page = true;
    let doc: ProseDoc;
    try {
      doc = store.readProse(id);
    } catch {
      counts.notRendered.push(id);
      continue;
    }
    const rendered = render(id, doc);
    if (rendered === null) continue;
    // THE MEMORY'S FEELINGS TRAVEL WITH IT (schema v7, review N7): a short
    // section after the body, one line each, so the readable copy says what the
    // database does. The database export carries the table whole.
    // Its trait nudges too (v9), the same way.
    const text = rendered + feelingsSection(store, id) + traitsSection(store, id);
    put(pathFor(store, row, doc), text);
    counts.rows += 1;
    if (row.type === "episode") counts.journal += 1;
    if (row.archived === 1) counts.archived += 1;

    if (opts.versions !== true) continue;
    for (const version of store.versions(id)) {
      let prior: ProseDoc;
      try {
        prior = store.readVersion(id, version.seq);
      } catch {
        counts.notRendered.push(`${id}@${String(version.seq)}`);
        continue;
      }
      const priorText = render(`${id}@${String(version.seq)}`, prior);
      if (priorText === null) continue;
      put(`versions/${id}/${String(version.seq).padStart(4, "0")}.md`, priorText);
      counts.versions += 1;
    }
  }

  // THE NIGHTS (dream INTERFACE-GAPS §4 and §7, closed 2026-10-09). A dream's
  // journal and a reflection's entry and morning share live in their own
  // tables, never as memories, so the loop above walked past them and the
  // readable copy said nothing about the nights at all.
  //
  // TWO PASSES (review of #331): every night's fate is decided before any file
  // is written, so a reflection's file never points at its dream's path when
  // that dream was left out, and a dream's file says the same of each
  // reflection after it.
  const fates = new Map<string, NightFate>();
  const fate = (dir: "dreams" | "reflections", id: string, date: string | null): NightFate => {
    const path = nightPath(dir, id, date);
    return path === null ? { left: "unrenderable" } : { path };
  };
  const reflections = store.reflections({ limit: Math.max(1, store.reflectionCount()) });
  const dreams = store.dreams({ limit: Math.max(1, store.dreamCount()) });
  for (const r of reflections) {
    fates.set(r.id, fate("reflections", r.id, r.date));
  }
  for (const dream of dreams) fates.set(dream.id, fate("dreams", dream.id, dream.date));
  for (const r of reflections) {
    const f = fates.get(r.id);
    if (f === undefined || "left" in f) {
      counts.notRendered.push(r.id);
      continue;
    }
    put(f.path, reflectionMarkdown(store, r, r.dream_id === null ? undefined : fates.get(r.dream_id)));
    counts.reflections += 1;
  }
  for (const dream of dreams) {
    const f = fates.get(dream.id);
    if (f === undefined || "left" in f) {
      counts.notRendered.push(dream.id);
      continue;
    }
    const after = store.reflections({ dreamId: dream.id }).map((r) => ({ id: r.id, fate: fates.get(r.id) }));
    put(f.path, dreamMarkdown(store, dream, after));
    counts.dreams += 1;
  }

  put("README.md", markdownReadme(census));
  return { bundle, census };
}

/** Where one row's markdown goes in the tree. Ids only; never a title. */
/** `\n## Feelings\n\n1. owner · uneasy · worried · 0.6 — carried by …`, or "" when none. A
 *  valence the writer gave (v11) follows the strength; the word's default is not written. */
function feelingsSection(store: Store, id: string): string {
  let rows;
  try {
    rows = store.feelingsFor(id);
  } catch {
    return "";
  }
  if (rows.length === 0) return "";
  const index = new Map(rows.map((r, i) => [r.id, i + 1]));
  const lines = rows.map((r, i) => {
    const word = r.emotion === "other" ? `other: ${r.other_word ?? ""}` : r.emotion;
    const under = r.beneath_id === null ? "" : ` · over #${String(index.get(r.beneath_id) ?? "?")}`;
    const by = r.carried_by.length === 0 ? "" : ` — carried by: ${r.carried_by.replace(/\r?\n/g, " ")}`;
    const valence = r.valence === null || r.valence === undefined ? "" : ` · valence ${String(r.valence)}`;
    return `${String(i + 1)}. ${r.whose} · ${r.core} · ${word} · ${String(r.strength)}${valence}${under}${by}`;
  });
  return `\n\n## Feelings\n\n${lines.join("\n")}\n`;
}

/** `\n## Traits\n\n1. agreeable-candid → candid · 0.6 — carried by …`, or "" when none. */
function traitsSection(store: Store, id: string): string {
  let rows;
  try {
    rows = store.traitsFor(id);
  } catch {
    return "";
  }
  if (rows.length === 0) return "";
  const lines = rows.map((r, i) => {
    const by = r.carried_by.length === 0 ? "" : ` — carried by: ${r.carried_by.replace(/\r?\n/g, " ")}`;
    return `${String(i + 1)}. ${r.axis} → ${r.toward} · ${String(r.strength)}${by}`;
  });
  return `\n\n## Traits\n\n${lines.join("\n")}\n`;
}

function pathFor(store: Store, row: MemoryRow, doc: ProseDoc): string {
  if (row.type === "episode") return journalRelativePath(doc);
  if (row.type === "schema") {
    // THE SELF PAGE IS ITS OWN FILE, at the top, because it is the one document
    // in the store the owner is most likely to want on its own.
    return isSelfPageRow(store, row.id) ? "self-page.md" : `schemas/${row.id}.md`;
  }
  return `memories/${row.kind}/${row.id}.md`;
}

/**
 * Where a dream's or a reflection's file goes: `dreams/<year>/<date>-<id>.md`,
 * the journal's own layout, `undated` the same way. Ids only, never a title.
 * Null for an id that is not one plain path segment — none of ours is ever
 * anything else, and a row that is would be named, not written somewhere odd.
 */
function nightPath(dir: "dreams" | "reflections", id: string, date: string | null): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const day = date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : UNDATED;
  return `${dir}/${day === UNDATED ? UNDATED : day.slice(0, 4)}/${day}-${id}.md`;
}

/** What became of one night in this export: its file, or why it has none. */
type NightFate = { readonly path: string } | { readonly left: "unrenderable" };

/** How one night file names another: ` — \`path\``, or why that one is not in this copy. */
function nightWhere(f: NightFate | undefined): string {
  if (f === undefined) return " (not in this copy)";
  if ("path" in f) return ` — \`${f.path}\``;
  return " (not in this copy: its file could not be written; the README names it)";
}

/** The front matter both kinds of night share: the memory files' fence and
 *  one `key: value` line each, and no `payload:` line — that line is how a
 *  future importer reads a MEMORY back, and a night is not one. */
function nightFrontMatter(lines: readonly (readonly [string, string | number | null])[]): string {
  const kept = lines.filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${String(v).replace(/\r?\n/g, " ")}`);
  return `---\n${kept.join("\n")}\n---\n`;
}

/**
 * ONE DREAM, readable: its journal as the dream wrote it, then every change it
 * made in the words `dream --show` uses (`dream-core.ts#dreamChangeWords`),
 * undone ones marked, then the reflections after it. A journal the owner's
 * removal redacted is exported as the line it now holds.
 */
function dreamMarkdown(
  store: Store,
  dream: DreamRow,
  after: readonly { readonly id: string; readonly fate: NightFate | undefined }[],
): string {
  const out = [
    nightFrontMatter([
      ["id", dream.id],
      ["type", "dream"],
      ["title", dream.title === null || dream.title.length === 0 ? null : dream.title],
      ["date", dream.date],
      ["livedDay", dream.day],
      ["state", dream.state],
      ["model", dream.model],
      ["session", dream.session],
    ]),
  ];
  if (dream.state === "undone") {
    out.push("This dream was undone: its changes were reversed, and its journal is kept.\n\n");
  }
  out.push(
    dream.journal !== null && dream.journal.length > 0
      ? dream.journal
      : dream.state === "begun"
        ? "(No journal: this dream was begun and never finished.)"
        : "(No journal was written.)",
  );
  const changes = store.dreamChanges(dream.id);
  out.push("\n\n## Changes\n\n");
  if (changes.length === 0) out.push("None.\n");
  for (const c of changes) {
    const [head, ...under] = dreamChangeWords({ store }, c);
    out.push(`- ${c.undone === 1 ? "[undone] " : ""}${head}\n`);
    for (const line of under) out.push(`  - ${line}\n`);
  }
  if (after.length > 0) {
    out.push("\n## Reflected on afterwards\n\n");
    for (const r of after) out.push(`- ${r.id}${nightWhere(r.fate)}\n`);
  }
  return out.join("");
}

/**
 * ONE REFLECTION, readable: what it was asked, its entry, what the entry rests
 * on, its morning share and what became of it (`dream-core.ts#SHARE_STATE_WORDS`),
 * and the page version it wrote. An entry that cited anything is also a memory
 * of source `reflection`, and is in `memories/` as well; this file says which.
 */
function reflectionMarkdown(store: Store, r: ReflectionRow, dreamFate: NightFate | undefined): string {
  const out = [
    nightFrontMatter([
      ["id", r.id],
      ["type", "reflection"],
      ["date", r.date],
      ["livedDay", r.day],
      ["state", r.state],
      ["after", r.dream_id ?? "none (it reflected on its own)"],
      ["model", r.model],
      ["session", r.session],
    ]),
  ];
  // Its dream's file only when that dream is in this copy too (review of
  // #331): a dream whose file could not be written is said so.
  if (r.dream_id !== null && dreamFate !== undefined) out.push(`After dream ${r.dream_id}${nightWhere(dreamFate)}.\n\n`);
  const questions = parseIdList(r.questions);
  out.push("## Asked\n\n");
  out.push(questions.length === 0 ? "(Nothing recorded.)\n" : questions.map((q) => `- ${q.replace(/\r?\n/g, " ")}\n`).join(""));
  out.push("\n## Entry\n\n");
  out.push(
    r.entry !== null && r.entry.length > 0
      ? `${r.entry}\n`
      : r.state === "reflected"
        ? "(No entry was written.)\n"
        : "(No entry: this reflection was begun and never finished.)\n",
  );
  if (r.entry_id !== null) out.push(`\nKept as memory ${r.entry_id}.\n`);
  const cites = parseIdList(r.cites);
  if (cites.length > 0) {
    out.push("\n## It rests on\n\n");
    for (const c of cites) out.push(`- ${c} "${memoryWords({ store }, c)}"\n`);
  }
  out.push("\n## Morning share\n\n");
  if (r.share === null || r.share.length === 0) {
    out.push("None.\n");
  } else {
    out.push(`${r.share}\n\n${capitalise(SHARE_STATE_WORDS[r.share_state] ?? r.share_state)}.\n`);
  }
  if (r.page_version !== null) {
    out.push(`\n## Self page\n\nIt rewrote the self page: version ${String(r.page_version)} (\`self-page.md\` is the page as it stands now).\n`);
  }
  return out.join("");
}

function capitalise(s: string): string {
  return s.length === 0 ? s : `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`;
}

/**
 * Remove any `.export-scratch-*` an interrupted export of an OLDER BUILD left in
 * this target.
 *
 * Belt and braces for exactly one window: a build between the floor landing and
 * this fix wrote its scratch here, and a kill during the vacuum left a
 * plaintext copy of the store behind under a timestamped name that the next
 * export would never collide with. Nothing writes that name any more; this is
 * how the ones already on disk go. It never throws — an export must not fail
 * because a stale file would not delete.
 */
function sweepStaleScratch(target: string): void {
  try {
    for (const name of readdirSync(target)) {
      if (!name.startsWith(".export-scratch-")) continue;
      rmSync(join(target, name), { recursive: true, force: true });
    }
  } catch {
    /* an unreadable target fails for its own reasons, further down */
  }
}

/** What the report says when this export cleaned up after an interrupted one. */
function sweptNote(swept: readonly string[]): string {
  if (swept.length === 0) return "";
  return (
    ` Also removed ${String(swept.length)} abandoned scratch ` +
    `director${swept.length === 1 ? "y" : "ies"} an interrupted export had left in the temp dir ` +
    "(each held an unencrypted copy of the store)."
  );
}

/** The prefix this module's scratch directories wear, in the OS temp dir. */
export const EXPORT_SCRATCH_PREFIX = "counterparts-export-";

/**
 * How old an abandoned scratch directory must be before a later export removes
 * it. **The bound is the whole point**: without it this sweep would delete a
 * CONCURRENT export's directory mid-vacuum, which is a collision the target
 * sweep above cannot have (it matches a name nothing writes any more).
 *
 * Same reasoning and the same number as `adapters/snapshots.ts#PARTIAL_STALE_MS`:
 * comfortably longer than any single export could plausibly still be running.
 */
export const EXPORT_SCRATCH_STALE_MS = 60 * 60_000;

/**
 * Remove abandoned `counterparts-export-*` directories from the OS temp dir.
 *
 * An interrupted `--passphrase` export leaves a PLAINTEXT SQLite copy of the
 * whole store in one (0700, so only this user can read it) and nothing swept
 * it: on macOS `/var/folders` is reaped after roughly three days of non-access,
 * otherwise it sits there (review f5c, NEW-MINOR-6). Moving it out of the
 * target was the big win; this is the rest of it.
 *
 * Exact prefix, `mtime` older than the bound, and only entries this user owns —
 * the temp dir is shared on some systems, and a sweep that took somebody else's
 * directory would be a worse bug than the one it fixes. Never throws.
 */
export function sweepStaleExportScratch(now = Date.now()): string[] {
  const swept: string[] = [];
  const root = tmpdir();
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return swept;
  }
  for (const name of names) {
    if (!name.startsWith(EXPORT_SCRATCH_PREFIX)) continue;
    const full = join(root, name);
    try {
      const st = statSync(full);
      if (!st.isDirectory()) continue;
      if (st.uid !== process.getuid?.()) continue;
      if (now - st.mtimeMs < EXPORT_SCRATCH_STALE_MS) continue;
      rmSync(full, { recursive: true, force: true });
      swept.push(name);
    } catch {
      /* a directory that will not stat or will not go is not this export's problem */
    }
  }
  return swept;
}

export function exportStore(store: Store, opts: ExportOptions): ExportReport {
  const kind: ExportKind = opts.markdown === true ? "markdown" : "database";
  const refused = (reason: string): ExportReport => ({
    ok: false,
    mode: "refused",
    kind,
    target: opts.target,
    files: 0,
    bytes: 0,
    reason,
    rows: 0,
    omittedConfidential: 0,
    notRendered: [],
    dreams: 0,
    reflections: 0,
    omittedDreams: 0,
    omittedReflections: 0,
  });

  const encrypting = typeof opts.passphrase === "string" && opts.passphrase.length > 0;
  if (!encrypting && opts.plaintext !== true) {
    return refused(
      "export refuses to choose for you: pass --passphrase <secret> to encrypt, or --plaintext to say out loud that this copy is unencrypted.",
    );
  }
  if (kind === "database" && (opts.includeConfidential === true || opts.versions === true)) {
    // NOT A HALF-KEPT PROMISE. `--versions` decides what goes into the readable
    // tree; a database export carries every row there is, so honouring it there
    // would be a lie in one direction and ignoring it, silently, a lie in the
    // other. `--include-confidential` (ignored since 2026-10-21, kept for one
    // release) is refused here by name as it always was, so a script that
    // passed it the wrong way round still hears so.
    return refused(
      "--include-confidential and --with-versions are about the readable tree: pass --markdown with them, or drop them (a database export carries every row and every archived wording).",
    );
  }

  let target: string;
  try {
    target = assertSafeTarget(store.dir, opts.target);
    mkdirSync(target, { recursive: true });
    // …and the ones an interrupted export of an older build left HERE, swept
    // BEFORE the emptiness question below: `.export-scratch-*` is a name nothing
    // writes any more, and a target holding only that is a target that is empty
    // as far as the owner is concerned.
    sweepStaleScratch(target);
    const existing = readdirSync(target);
    if (existing.length > 0 && opts.intoNonEmpty !== true) {
      return refused(
        `refusing to write into a directory that is not empty: ${target} already holds ${String(existing.length)} ` +
          `entr${existing.length === 1 ? "y" : "ies"}. An export is a whole copy, and writing one over another leaves a ` +
          "mixture of two that nothing can tell apart. Name an empty directory, or pass --into-non-empty.",
      );
    }
  } catch (err) {
    return refused(String((err as Error).message ?? err));
  }

  // THE SCRATCH GOES IN THE OS TEMP DIR — not in the store, and NOT IN THE
  // TARGET.
  //
  // It lived in `<store>/tmp/` until the floor deleted that directory with the
  // staging it existed for, and a scratch file in the store would now fail the
  // next `assertLayout()` as an unclassified top-level path (§5 G11). The first
  // fix moved it into the target, which `assertSafeTarget` proves is outside
  // the store — and that was the wrong outside. The scratch is a PLAINTEXT
  // SQLite copy of the whole store, and the target of a `--passphrase` export
  // is by definition the place the copy is going: an external disk, a synced
  // folder, the directory the owner is about to hand somebody. Review B killed
  // an exporter mid-`VACUUM INTO` and found a 4 MB unencrypted copy of the
  // memories left behind under a timestamped name that nothing would ever
  // overwrite or sweep (MAJOR-4). `--passphrase` exists precisely to say "this
  // copy leaves the machine".
  //
  // `mkdtempSync` gives it a private directory (0700 by construction) that the
  // OS reaps, so an interrupted export leaks at worst into a temp dir rather
  // than into the artefact. The whole directory goes in the `finally`.
  //
  // …and the ones an interrupted export of our own left in the OS temp dir.
  // Said out loud rather than done in silence: it is the owner's plaintext.
  const sweptScratch = sweepStaleExportScratch();
  let bundle: Bundle;
  let census: MarkdownCensus | null = null;
  if (kind === "markdown") {
    // NO SCRATCH AT ALL. The readable tree is rendered from rows into memory,
    // so a `--markdown --passphrase` export never puts one plaintext byte
    // anywhere: not in the target, not in the temp dir. The pair is supported
    // properly rather than refused — the whole bundle is built, then encrypted,
    // then one blob is written, which is the same path the database export's
    // encrypted arm already takes.
    const built = collectMarkdown(store, opts);
    bundle = built.bundle;
    census = built.census;
  } else {
    const scratchDir = mkdtempSync(join(tmpdir(), EXPORT_SCRATCH_PREFIX));
    const tmpDb = join(scratchDir, "scratch.sqlite");
    try {
      bundle = collect(store, tmpDb);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  let bytes = 0;
  for (const buf of bundle.values()) bytes += buf.length;
  const counted = {
    rows: census?.rows ?? 0,
    // Always 0 since 2026-10-21; the fields stay one release (`ExportReport`).
    omittedConfidential: 0,
    notRendered: census?.notRendered ?? [],
    dreams: census?.dreams ?? 0,
    reflections: census?.reflections ?? 0,
    omittedDreams: 0,
    omittedReflections: 0,
  };

  if (!encrypting) {
    // A COLLISION IS A REFUSAL, unless the owner said to replace.
    //
    // `--into-non-empty` means "I know this directory has things in it"; it
    // does not mean "replace them without telling me". The review watched an
    // export overwrite a README.md that said "SOMEBODY ELSE'S README —
    // irreplaceable" and report nothing (MINOR-3). Nothing is written until
    // every path has been checked, so a refused export leaves the directory
    // exactly as it found it.
    const collisions = [...bundle.keys()].filter((path) => existsSync(join(target, path))).sort();
    if (collisions.length > 0 && opts.overwrite !== true) {
      return refused(
        `refusing to replace ${String(collisions.length)} file${collisions.length === 1 ? "" : "s"} that ${collisions.length === 1 ? "is" : "are"} already in ${target}: ` +
          `${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? `, and ${String(collisions.length - 5)} more` : ""}. ` +
          "Name an empty directory, or pass --overwrite to replace exactly those.",
      );
    }
    for (const [path, buf] of bundle) {
      const out = join(target, path);
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, buf);
    }
    // The markdown tree writes its OWN manifest, as one of its files, so what
    // it holds is said inside the artefact as well as on the terminal.
    if (kind === "database") {
      writeFileSync(join(target, "README.md"), plaintextReadme(bundle.size, bytes), "utf8");
    }
    return {
      ok: true,
      mode: "plaintext",
      kind,
      target,
      files: bundle.size,
      bytes,
      reason:
        (kind === "markdown"
          ? "Unencrypted, at the owner's explicit request. Every file is plain markdown."
          : "Unencrypted, at the owner's explicit request. The database is readable by any SQLite.") +
        notRenderedNote(counted.notRendered) +
        replacedNote(collisions) +
        sweptNote(sweptScratch),
      ...counted,
    };
  }

  const blob = encryptBundle(bundle, opts.passphrase as string);
  writeFileSync(join(target, BLOB_NAME), blob);
  writeFileSync(join(target, "README.md"), encryptedReadme(bundle.size, bytes, kind), "utf8");
  return {
    ok: true,
    mode: "encrypted",
    kind,
    target,
    files: bundle.size,
    bytes,
    reason:
      `Encrypted with ${CIPHER} under a key derived from your passphrase. Lose the passphrase and this archive is gone.` +
      notRenderedNote(counted.notRendered) +
      sweptNote(sweptScratch),
    ...counted,
  };
}

/** WHICH files this export replaced, when the owner said to. The flag whose
 *  whole purpose is "I know this directory has things in it" is the one place
 *  the report must say which of them went (review f6f7 MINOR-3). */
function replacedNote(collisions: readonly string[]): string {
  if (collisions.length === 0) return "";
  return (
    ` Replaced ${String(collisions.length)} existing file${collisions.length === 1 ? "" : "s"}, at your request: ` +
    `${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? `, and ${String(collisions.length - 5)} more` : ""}.`
  );
}

/** Rows that could not be rendered, by id — named, never silently absent. */
function notRenderedNote(ids: readonly string[]): string {
  if (ids.length === 0) return "";
  return ` ${String(ids.length)} row${ids.length === 1 ? "" : "s"} could not be rendered and ${ids.length === 1 ? "is" : "are"} NOT in this copy: ${ids.join(", ")}.`;
}

export function encryptBundle(bundle: Bundle, passphrase: string): Buffer {
  const salt = randomBytes(KDF.saltBytes);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, KDF.keyBytes, { N: KDF.N, r: KDF.r, p: KDF.p });
  const manifest: Record<string, string> = {};
  for (const [path, buf] of bundle) manifest[path] = buf.toString("base64");
  const plain = gzipSync(Buffer.from(JSON.stringify(manifest), "utf8"));
  const cipher = createCipheriv(CIPHER, key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const envelope = {
    format: EXPORT_FORMAT,
    cipher: CIPHER,
    kdf: { name: "scrypt", ...KDF },
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: body.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

/**
 * The read-back half. It exists because a backup nobody has ever opened is not
 * evidence of anything (contract §7 OQ3, and §2.17's "an untried path is
 * unproven"): `test/cli.test.ts` round-trips a real export through it.
 */
export function decryptBundle(blob: Buffer, passphrase: string): Map<string, Buffer> {
  const envelope = JSON.parse(blob.toString("utf8")) as {
    format: string;
    kdf: { N: number; r: number; p: number; keyBytes: number };
    salt: string;
    iv: string;
    tag: string;
    payload: string;
  };
  if (envelope.format !== EXPORT_FORMAT) throw new Error(`unknown export format: ${envelope.format}`);
  const salt = Buffer.from(envelope.salt, "base64");
  const key = scryptSync(passphrase, salt, envelope.kdf.keyBytes, {
    N: envelope.kdf.N,
    r: envelope.kdf.r,
    p: envelope.kdf.p,
  });
  const decipher = createDecipheriv(CIPHER, key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = gunzipSync(
    Buffer.concat([decipher.update(Buffer.from(envelope.payload, "base64")), decipher.final()]),
  );
  const manifest = JSON.parse(plain.toString("utf8")) as Record<string, string>;
  const out = new Map<string, Buffer>();
  for (const [path, b64] of Object.entries(manifest)) out.set(path, Buffer.from(b64, "base64"));
  return out;
}

function plaintextReadme(files: number, bytes: number): string {
  return [
    "# Counterparts export (UNENCRYPTED)",
    "",
    `${files} files, ${bytes} bytes, written at the owner's explicit request with --plaintext.`,
    "",
    `- \`${DATABASE_FILE}\` — the whole store: the memories themselves, their`,
    "  archived versions, and every structured field. Copied through SQLite's own",
    "  VACUUM INTO, never as a file copy of a live database.",
    "",
    "The rebuildable cache is deliberately not included: it is reconstructed from",
    "the database above.",
    "",
    "This copy is not encrypted. Treat it the way you would treat the store itself.",
    "",
  ].join("\n");
}

/**
 * THE MANIFEST, and it is a file INSIDE the tree. The terminal scrolls away;
 * six months later the only thing left is the directory, and a directory that
 * does not say what is missing from it reads as complete. (Until 2026-10-21 it
 * also counted the confidential memories it omitted; nothing is omitted as
 * confidential any more.)
 */
function markdownReadme(census: MarkdownCensus): string {
  return [
    "# Counterparts export (markdown)",
    "",
    `${census.rows} rows, readable in any editor — memories, the journal, and the self page — ` +
      `and ${String(census.dreams)} dream${census.dreams === 1 ? "" : "s"} and ` +
      `${String(census.reflections)} reflection${census.reflections === 1 ? "" : "s"}.`,
    "Rendered from the database; this is a COPY, and the store itself is still where the",
    "memories live.",
    "",
    "## What is here",
    "",
    "- `memories/<kind>/<id>.md` — one file per memory, grouped by kind. The file name is",
    "  the memory's id; the title, dates and everything else are in the frontmatter, and",
    "  any feelings recorded on it are a `## Feelings` list after the words, and any trait",
    "  nudges a `## Traits` list after those.",
    census.archived === 0
      ? "  None of them is archived: every memory here is a live one."
      : `  ${String(census.archived)} of them ${census.archived === 1 ? "is" : "are"} ARCHIVED — faded, superseded or merged.` +
        " They are still your words, so they are here; the files do not mark which," +
        " and `counterparts status` is where that is readable.",
    census.page
      ? "- `self-page.md` — the written self page, as it stands."
      : "- `self-page.md` — absent: this store has no written self page.",
    "- `schemas/<id>.md` — the structured rows that are not the page (the identity core, beliefs).",
    `- \`journal/<year>/<date>-<id>.md\` — the first-person episode journal, as is: ` +
      `${String(census.journal)} episode${census.journal === 1 ? "" : "s"}.`,
    census.versions > 0
      ? `- \`versions/<id>/<seq>.md\` — ${String(census.versions)} earlier wording${census.versions === 1 ? "" : "s"}, oldest first (\`--with-versions\`).`
      : "- `versions/` — not included. Pass `--with-versions` to export every earlier wording too.",
    census.dreams === 0
      ? "- `dreams/` — none: this store has no dream to export."
      : `- \`dreams/<year>/<date>-<id>.md\` — ${String(census.dreams)} dream${census.dreams === 1 ? "" : "s"}, one file each:` +
        " its journal as it was written, every change it made (undone ones marked), and the" +
        " reflections after it. A dream's journal is not a memory, so it is here and not in `memories/`.",
    census.reflections === 0
      ? "- `reflections/` — none: this store has no reflection to export."
      : `- \`reflections/<year>/<date>-<id>.md\` — ${String(census.reflections)} reflection${census.reflections === 1 ? "" : "s"}, one file each:` +
        " what it was asked, its entry, what that entry rests on, and its morning share and what" +
        " became of it. An entry that cited a memory was also kept as a memory, so it is in `memories/` too.",
    "",
    "## What is NOT here",
    "",
    "- Removed memories. A removal is permanent; a tombstoned row has no words left to export.",
    census.notRendered.length === 0
      ? "- Nothing else. Every live row, dream and reflection this export could reach is in it."
      : `- ${String(census.notRendered.length)} row(s) whose markdown could not be rendered: ${census.notRendered.join(", ")}.`,
    "- The structured physics — strengths, edges, the association graph, the event log, and",
    "  the records a dream keeps beside its journal (what it was shown, what undoing it needs).",
    "  Those are in the database, and `counterparts export --out <dir> --plaintext` (without",
    "  `--markdown`) copies the whole thing as one SQLite file.",
    "",
    "Nothing reads this tree back in. Editing a file here changes nothing in your store.",
    "",
  ].join("\n");
}

function encryptedReadme(files: number, bytes: number, kind: ExportKind): string {
  return [
    "# Counterparts export (encrypted)",
    "",
    `\`${BLOB_NAME}\` holds ${files} files (${bytes} bytes before compression) — ` +
      (kind === "markdown"
        ? "the readable markdown tree, including its own manifest."
        : "the whole store as one SQLite database."),
    "",
    "Format, so this is never an archive you cannot open:",
    "",
    `1. The blob is JSON: \`{format, cipher, kdf, salt, iv, tag, payload}\` — all base64.`,
    `2. Key = scrypt(passphrase, salt, N/r/p from the \`kdf\` field), ${KDF.keyBytes} bytes.`,
    `3. Payload = ${CIPHER}(gzip(JSON manifest of path -> base64 file bytes)).`,
    "",
    "The passphrase is yours and is not stored anywhere. There is no recovery path;",
    "that is the point of it being owner-keyed.",
    "",
  ].join("\n");
}
