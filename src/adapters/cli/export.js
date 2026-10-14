import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, relative } from "node:path";
import {
  DATABASE_FILE,
  confidentialByMeta,
  paths,
  renderMarkdown,
  rowTombstoned
} from "../../core/store/index.js";
import { isSelfPageRow } from "../../core/self/page.js";
import { UNDATED, journalRelativePath } from "../../core/self/journal-file.js";
import { SHARE_STATE_WORDS, dreamChangeWords, memoryWords, parseIdList } from "./dream-core.js";
import { assertSafeTarget, vacuumInto } from "./snapshot.js";
export const KDF = { N: 16384, r: 8, p: 1, keyBytes: 32, saltBytes: 16 };
export const CIPHER = "aes-256-gcm";
export const EXPORT_FORMAT = "counterparts-export-1";
export const BLOB_NAME = "counterparts-export.cpx";
function collect(store, tmpDb) {
  const bundle = new Map;
  const copied = vacuumInto(paths.operational(store.dir), tmpDb);
  if (copied.ok)
    bundle.set(DATABASE_FILE, readFileSync(tmpDb));
  return bundle;
}
function collectMarkdown(store, opts) {
  const bundle = new Map;
  const census = {
    rows: 0,
    omittedConfidential: 0,
    notRendered: [],
    journal: 0,
    versions: 0,
    page: false,
    pageOmitted: false,
    omittedVersions: 0,
    archived: 0,
    dreams: 0,
    reflections: 0,
    omittedDreams: 0,
    omittedReflections: 0
  };
  const counts = census;
  const denied = new Set(store.deniedIds());
  const put = (path, text) => {
    bundle.set(path, Buffer.from(text, "utf8"));
  };
  const render = (id, doc) => {
    try {
      return renderMarkdown(doc);
    } catch {
      counts.notRendered.push(id);
      return null;
    }
  };
  for (const id of store.list()) {
    if (denied.has(id))
      continue;
    const row = store.row(id);
    if (row === undefined || rowTombstoned(row))
      continue;
    const isPage = row.type === "schema" && isSelfPageRow(store, id);
    if (isPage)
      counts.page = true;
    if (row.confidential === 1 && opts.includeConfidential !== true) {
      counts.omittedConfidential += 1;
      if (isPage)
        counts.pageOmitted = true;
      continue;
    }
    let doc;
    try {
      doc = store.readProse(id);
    } catch {
      counts.notRendered.push(id);
      continue;
    }
    const rendered = render(id, doc);
    if (rendered === null)
      continue;
    const text = rendered + feelingsSection(store, id) + traitsSection(store, id);
    put(pathFor(store, row, doc), text);
    counts.rows += 1;
    if (row.type === "episode")
      counts.journal += 1;
    if (row.archived === 1)
      counts.archived += 1;
    if (opts.versions !== true)
      continue;
    for (const version of store.versions(id)) {
      let prior;
      try {
        prior = store.readVersion(id, version.seq);
      } catch {
        counts.notRendered.push(`${id}@${String(version.seq)}`);
        continue;
      }
      if (opts.includeConfidential !== true && confidentialByMeta(prior.meta)) {
        counts.omittedVersions += 1;
        continue;
      }
      const priorText = render(`${id}@${String(version.seq)}`, prior);
      if (priorText === null)
        continue;
      put(`versions/${id}/${String(version.seq).padStart(4, "0")}.md`, priorText);
      counts.versions += 1;
    }
  }
  const fates = new Map;
  const fate = (dir, id, date, rests) => {
    const path = nightPath(dir, id, date);
    if (path === null)
      return { left: "unrenderable" };
    if (opts.includeConfidential !== true && restsOnConfidential(store, rests))
      return { left: "confidential" };
    return { path };
  };
  const reflections = store.reflections({ limit: Math.max(1, store.reflectionCount()) });
  const dreams = store.dreams({ limit: Math.max(1, store.dreamCount()) });
  for (const r of reflections) {
    fates.set(r.id, fate("reflections", r.id, r.date, [...parseIdList(r.shown), ...parseIdList(r.cites), ...parseIdList(r.share_cites), r.entry_id]));
  }
  for (const dream of dreams) {
    const changes = store.dreamChanges(dream.id);
    fates.set(dream.id, fate("dreams", dream.id, dream.date, [...parseIdList(dream.shown), ...changes.flatMap((c) => [c.ref, c.ref2])]));
  }
  for (const r of reflections) {
    const f = fates.get(r.id);
    if (f === undefined || "left" in f) {
      if (f?.left === "confidential")
        counts.omittedReflections += 1;
      else
        counts.notRendered.push(r.id);
      continue;
    }
    put(f.path, reflectionMarkdown(store, r, r.dream_id === null ? undefined : fates.get(r.dream_id)));
    counts.reflections += 1;
  }
  for (const dream of dreams) {
    const f = fates.get(dream.id);
    if (f === undefined || "left" in f) {
      if (f?.left === "confidential")
        counts.omittedDreams += 1;
      else
        counts.notRendered.push(dream.id);
      continue;
    }
    const after = store.reflections({ dreamId: dream.id }).map((r) => ({ id: r.id, fate: fates.get(r.id) }));
    put(f.path, dreamMarkdown(store, dream, after));
    counts.dreams += 1;
  }
  put("README.md", markdownReadme(census, opts));
  return { bundle, census };
}
function feelingsSection(store, id) {
  let rows;
  try {
    rows = store.feelingsFor(id);
  } catch {
    return "";
  }
  if (rows.length === 0)
    return "";
  const index = new Map(rows.map((r, i) => [r.id, i + 1]));
  const lines = rows.map((r, i) => {
    const word = r.emotion === "other" ? `other: ${r.other_word ?? ""}` : r.emotion;
    const under = r.beneath_id === null ? "" : ` · over #${String(index.get(r.beneath_id) ?? "?")}`;
    const by = r.carried_by.length === 0 ? "" : ` — carried by: ${r.carried_by.replace(/\r?\n/g, " ")}`;
    const valence = r.valence === null || r.valence === undefined ? "" : ` · valence ${String(r.valence)}`;
    return `${String(i + 1)}. ${r.whose} · ${r.core} · ${word} · ${String(r.strength)}${valence}${under}${by}`;
  });
  return `

## Feelings

${lines.join(`
`)}
`;
}
function traitsSection(store, id) {
  let rows;
  try {
    rows = store.traitsFor(id, { includeConfidential: true });
  } catch {
    return "";
  }
  if (rows.length === 0)
    return "";
  const lines = rows.map((r, i) => {
    const by = r.carried_by.length === 0 ? "" : ` — carried by: ${r.carried_by.replace(/\r?\n/g, " ")}`;
    return `${String(i + 1)}. ${r.axis} → ${r.toward} · ${String(r.strength)}${by}`;
  });
  return `

## Traits

${lines.join(`
`)}
`;
}
function pathFor(store, row, doc) {
  if (row.type === "episode")
    return journalRelativePath(doc);
  if (row.type === "schema") {
    return isSelfPageRow(store, row.id) ? "self-page.md" : `schemas/${row.id}.md`;
  }
  return `memories/${row.kind}/${row.id}.md`;
}
function nightPath(dir, id, date) {
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    return null;
  const day = date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : UNDATED;
  return `${dir}/${day === UNDATED ? UNDATED : day.slice(0, 4)}/${day}-${id}.md`;
}
function nightWhere(f) {
  if (f === undefined)
    return " (not in this copy)";
  if ("path" in f)
    return ` — \`${f.path}\``;
  return f.left === "confidential" ? " (left out of this copy: it rests on a confidential memory)" : " (not in this copy: its file could not be written; the README names it)";
}
function restsOnConfidential(store, ids) {
  for (const id of ids) {
    if (id === null)
      continue;
    const row = store.row(id);
    if (row === undefined || rowTombstoned(row))
      continue;
    if (row.confidential === 1)
      return true;
  }
  return false;
}
function nightFrontMatter(lines) {
  const kept = lines.filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${String(v).replace(/\r?\n/g, " ")}`);
  return `---
${kept.join(`
`)}
---
`;
}
function dreamMarkdown(store, dream, after) {
  const out = [
    nightFrontMatter([
      ["id", dream.id],
      ["type", "dream"],
      ["title", dream.title === null || dream.title.length === 0 ? null : dream.title],
      ["date", dream.date],
      ["livedDay", dream.day],
      ["state", dream.state],
      ["model", dream.model],
      ["session", dream.session]
    ])
  ];
  if (dream.state === "undone") {
    out.push(`This dream was undone: its changes were reversed, and its journal is kept.

`);
  }
  out.push(dream.journal !== null && dream.journal.length > 0 ? dream.journal : dream.state === "begun" ? "(No journal: this dream was begun and never finished.)" : "(No journal was written.)");
  const changes = store.dreamChanges(dream.id);
  out.push(`

## Changes

`);
  if (changes.length === 0)
    out.push(`None.
`);
  for (const c of changes) {
    const [head, ...under] = dreamChangeWords({ store }, c);
    out.push(`- ${c.undone === 1 ? "[undone] " : ""}${head}
`);
    for (const line of under)
      out.push(`  - ${line}
`);
  }
  if (after.length > 0) {
    out.push(`
## Reflected on afterwards

`);
    for (const r of after)
      out.push(`- ${r.id}${nightWhere(r.fate)}
`);
  }
  return out.join("");
}
function reflectionMarkdown(store, r, dreamFate) {
  const out = [
    nightFrontMatter([
      ["id", r.id],
      ["type", "reflection"],
      ["date", r.date],
      ["livedDay", r.day],
      ["state", r.state],
      ["after", r.dream_id ?? "none (it reflected on its own)"],
      ["model", r.model],
      ["session", r.session]
    ])
  ];
  if (r.dream_id !== null && dreamFate !== undefined)
    out.push(`After dream ${r.dream_id}${nightWhere(dreamFate)}.

`);
  const questions = parseIdList(r.questions);
  out.push(`## Asked

`);
  out.push(questions.length === 0 ? `(Nothing recorded.)
` : questions.map((q) => `- ${q.replace(/\r?\n/g, " ")}
`).join(""));
  out.push(`
## Entry

`);
  out.push(r.entry !== null && r.entry.length > 0 ? `${r.entry}
` : r.state === "reflected" ? `(No entry was written.)
` : `(No entry: this reflection was begun and never finished.)
`);
  if (r.entry_id !== null)
    out.push(`
Kept as memory ${r.entry_id}.
`);
  const cites = parseIdList(r.cites);
  if (cites.length > 0) {
    out.push(`
## It rests on

`);
    for (const c of cites)
      out.push(`- ${c} "${memoryWords({ store }, c)}"
`);
  }
  out.push(`
## Morning share

`);
  if (r.share === null || r.share.length === 0) {
    out.push(`None.
`);
  } else {
    out.push(`${r.share}

${capitalise(SHARE_STATE_WORDS[r.share_state] ?? r.share_state)}.
`);
  }
  if (r.page_version !== null) {
    out.push(`
## Self page

It rewrote the self page: version ${String(r.page_version)} (\`self-page.md\` is the page as it stands now).
`);
  }
  return out.join("");
}
function capitalise(s) {
  return s.length === 0 ? s : `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`;
}
function sweepStaleScratch(target) {
  try {
    for (const name of readdirSync(target)) {
      if (!name.startsWith(".export-scratch-"))
        continue;
      rmSync(join(target, name), { recursive: true, force: true });
    }
  } catch {}
}
function sweptNote(swept) {
  if (swept.length === 0)
    return "";
  return ` Also removed ${String(swept.length)} abandoned scratch ` + `director${swept.length === 1 ? "y" : "ies"} an interrupted export had left in the temp dir ` + "(each held an unencrypted copy of the store).";
}
export const EXPORT_SCRATCH_PREFIX = "counterparts-export-";
export const EXPORT_SCRATCH_STALE_MS = 60 * 60000;
export function sweepStaleExportScratch(now = Date.now()) {
  const swept = [];
  const root = tmpdir();
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return swept;
  }
  for (const name of names) {
    if (!name.startsWith(EXPORT_SCRATCH_PREFIX))
      continue;
    const full = join(root, name);
    try {
      const st = statSync(full);
      if (!st.isDirectory())
        continue;
      if (st.uid !== process.getuid?.())
        continue;
      if (now - st.mtimeMs < EXPORT_SCRATCH_STALE_MS)
        continue;
      rmSync(full, { recursive: true, force: true });
      swept.push(name);
    } catch {}
  }
  return swept;
}
export function exportStore(store, opts) {
  const kind = opts.markdown === true ? "markdown" : "database";
  const refused = (reason) => ({
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
    omittedReflections: 0
  });
  const encrypting = typeof opts.passphrase === "string" && opts.passphrase.length > 0;
  if (!encrypting && opts.plaintext !== true) {
    return refused("export refuses to choose for you: pass --passphrase <secret> to encrypt, or --plaintext to say out loud that this copy is unencrypted.");
  }
  if (kind === "database" && (opts.includeConfidential === true || opts.versions === true)) {
    return refused("--include-confidential and --with-versions are about the readable tree: pass --markdown with them, or drop them (a database export carries every row, confidential ones and every archived wording included).");
  }
  let target;
  try {
    target = assertSafeTarget(store.dir, opts.target);
    mkdirSync(target, { recursive: true });
    sweepStaleScratch(target);
    const existing = readdirSync(target);
    if (existing.length > 0 && opts.intoNonEmpty !== true) {
      return refused(`refusing to write into a directory that is not empty: ${target} already holds ${String(existing.length)} ` + `entr${existing.length === 1 ? "y" : "ies"}. An export is a whole copy, and writing one over another leaves a ` + "mixture of two that nothing can tell apart. Name an empty directory, or pass --into-non-empty.");
    }
  } catch (err) {
    return refused(String(err.message ?? err));
  }
  const sweptScratch = sweepStaleExportScratch();
  let bundle;
  let census = null;
  if (kind === "markdown") {
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
  for (const buf of bundle.values())
    bytes += buf.length;
  const counted = {
    rows: census?.rows ?? 0,
    omittedConfidential: census?.omittedConfidential ?? 0,
    omittedVersions: census?.omittedVersions ?? 0,
    notRendered: census?.notRendered ?? [],
    dreams: census?.dreams ?? 0,
    reflections: census?.reflections ?? 0,
    omittedDreams: census?.omittedDreams ?? 0,
    omittedReflections: census?.omittedReflections ?? 0
  };
  if (!encrypting) {
    const collisions = [...bundle.keys()].filter((path) => existsSync(join(target, path))).sort();
    if (collisions.length > 0 && opts.overwrite !== true) {
      return refused(`refusing to replace ${String(collisions.length)} file${collisions.length === 1 ? "" : "s"} that ${collisions.length === 1 ? "is" : "are"} already in ${target}: ` + `${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? `, and ${String(collisions.length - 5)} more` : ""}. ` + "Name an empty directory, or pass --overwrite to replace exactly those.");
    }
    for (const [path, buf] of bundle) {
      const out = join(target, path);
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, buf);
    }
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
      reason: (kind === "markdown" ? "Unencrypted, at the owner's explicit request. Every file is plain markdown." : "Unencrypted, at the owner's explicit request. The database is readable by any SQLite.") + confidentialNote(counted, opts) + notRenderedNote(counted.notRendered) + replacedNote(collisions) + sweptNote(sweptScratch),
      ...counted
    };
  }
  const blob = encryptBundle(bundle, opts.passphrase);
  writeFileSync(join(target, BLOB_NAME), blob);
  writeFileSync(join(target, "README.md"), encryptedReadme(bundle.size, bytes, kind), "utf8");
  return {
    ok: true,
    mode: "encrypted",
    kind,
    target,
    files: bundle.size,
    bytes,
    reason: `Encrypted with ${CIPHER} under a key derived from your passphrase. Lose the passphrase and this archive is gone.` + confidentialNote(counted, opts) + notRenderedNote(counted.notRendered) + sweptNote(sweptScratch),
    ...counted
  };
}
function confidentialNote(counted, opts) {
  if (opts.markdown !== true)
    return "";
  if (opts.includeConfidential === true) {
    return " Confidential rows are INCLUDED, because --include-confidential was passed.";
  }
  const omitted = counted.omittedConfidential;
  const omittedVersions = counted.omittedVersions;
  const nights = nightsWords(counted.omittedDreams, counted.omittedReflections);
  if (omitted === 0 && omittedVersions === 0 && nights === null) {
    return " No confidential rows were left out (there were none).";
  }
  let said = "";
  if (omitted > 0 || omittedVersions > 0) {
    const versions = omittedVersions === 0 ? "" : ` and ${String(omittedVersions)} confidential earlier wording${omittedVersions === 1 ? "" : "s"}`;
    const one = omitted === 1 && versions === "";
    said += ` ${String(omitted)} confidential row${omitted === 1 ? "" : "s"}${versions}` + `${one ? " was" : " were"} left out;` + ` pass --include-confidential to take ${one ? "it" : "them"} too.`;
  }
  if (nights !== null) {
    said += ` ${nights.words} that rest${nights.one ? "s" : ""} on a confidential memory ${nights.one ? "was" : "were"} left out` + (omitted > 0 || omittedVersions > 0 ? " too." : `; pass --include-confidential to take ${nights.one ? "it" : "them"} too.`);
  }
  return said;
}
function nightsWords(dreams, reflections) {
  const parts = [];
  if (dreams > 0)
    parts.push(`${String(dreams)} dream${dreams === 1 ? "" : "s"}`);
  if (reflections > 0)
    parts.push(`${String(reflections)} reflection${reflections === 1 ? "" : "s"}`);
  if (parts.length === 0)
    return null;
  return { words: parts.join(" and "), one: dreams + reflections === 1 };
}
function replacedNote(collisions) {
  if (collisions.length === 0)
    return "";
  return ` Replaced ${String(collisions.length)} existing file${collisions.length === 1 ? "" : "s"}, at your request: ` + `${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? `, and ${String(collisions.length - 5)} more` : ""}.`;
}
function notRenderedNote(ids) {
  if (ids.length === 0)
    return "";
  return ` ${String(ids.length)} row${ids.length === 1 ? "" : "s"} could not be rendered and ${ids.length === 1 ? "is" : "are"} NOT in this copy: ${ids.join(", ")}.`;
}
export function encryptBundle(bundle, passphrase) {
  const salt = randomBytes(KDF.saltBytes);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, KDF.keyBytes, { N: KDF.N, r: KDF.r, p: KDF.p });
  const manifest = {};
  for (const [path, buf] of bundle)
    manifest[path] = buf.toString("base64");
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
    payload: body.toString("base64")
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}
export function decryptBundle(blob, passphrase) {
  const envelope = JSON.parse(blob.toString("utf8"));
  if (envelope.format !== EXPORT_FORMAT)
    throw new Error(`unknown export format: ${envelope.format}`);
  const salt = Buffer.from(envelope.salt, "base64");
  const key = scryptSync(passphrase, salt, envelope.kdf.keyBytes, {
    N: envelope.kdf.N,
    r: envelope.kdf.r,
    p: envelope.kdf.p
  });
  const decipher = createDecipheriv(CIPHER, key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = gunzipSync(Buffer.concat([decipher.update(Buffer.from(envelope.payload, "base64")), decipher.final()]));
  const manifest = JSON.parse(plain.toString("utf8"));
  const out = new Map;
  for (const [path, b64] of Object.entries(manifest))
    out.set(path, Buffer.from(b64, "base64"));
  return out;
}
function plaintextReadme(files, bytes) {
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
    ""
  ].join(`
`);
}
function markdownReadme(census, opts) {
  const omitted = opts.includeConfidential === true ? "- Confidential memories are **included**: `--include-confidential` was passed." : census.omittedConfidential === 0 && census.omittedVersions === 0 ? "- Confidential memories omitted: **0** (there were none)." : `- Confidential memories omitted: **${String(census.omittedConfidential)}**` + (opts.versions === true ? `, and **${String(census.omittedVersions)}** confidential earlier wording${census.omittedVersions === 1 ? "" : "s"} of memories that are otherwise here.` : ". (Earlier wordings were not being exported; `--with-versions` writes them, confidential ones excepted.)") + " They are still in your store; re-run with `--include-confidential` to take them too.";
  const nightsOmitted = opts.includeConfidential === true ? [] : [
    `- Dreams and reflections that rest on a confidential memory (were shown one, changed one or cite one): ` + `**${String(census.omittedDreams)}** dream${census.omittedDreams === 1 ? "" : "s"}, ` + `**${String(census.omittedReflections)}** reflection${census.omittedReflections === 1 ? "" : "s"}.` + (census.omittedDreams + census.omittedReflections > 0 ? " `--include-confidential` takes them too." : "")
  ];
  return [
    "# Counterparts export (markdown)",
    "",
    `${census.rows} rows, readable in any editor — memories, the journal, and the self page — ` + `and ${String(census.dreams)} dream${census.dreams === 1 ? "" : "s"} and ` + `${String(census.reflections)} reflection${census.reflections === 1 ? "" : "s"}.`,
    "Rendered from the database; this is a COPY, and the store itself is still where the",
    "memories live.",
    "",
    "## What is here",
    "",
    "- `memories/<kind>/<id>.md` — one file per memory, grouped by kind. The file name is",
    "  the memory's id; the title, dates and everything else are in the frontmatter, and",
    "  any feelings recorded on it are a `## Feelings` list after the words, and any trait",
    "  nudges a `## Traits` list after those.",
    census.archived === 0 ? "  None of them is archived: every memory here is a live one." : `  ${String(census.archived)} of them ${census.archived === 1 ? "is" : "are"} ARCHIVED — faded, superseded or merged.` + " They are still your words, so they are here; the files do not mark which," + " and `counterparts status` is where that is readable.",
    census.pageOmitted ? "- `self-page.md` — **omitted as confidential**. This store HAS a written self page; it was left out of this copy. `--include-confidential` takes it." : census.page ? "- `self-page.md` — the written self page, as it stands." : "- `self-page.md` — absent: this store has no written self page.",
    "- `schemas/<id>.md` — the structured rows that are not the page (the identity core, beliefs).",
    `- \`journal/<year>/<date>-<id>.md\` — the first-person episode journal, as is: ` + `${String(census.journal)} episode${census.journal === 1 ? "" : "s"}.`,
    census.versions > 0 ? `- \`versions/<id>/<seq>.md\` — ${String(census.versions)} earlier wording${census.versions === 1 ? "" : "s"}, oldest first (\`--with-versions\`).` : "- `versions/` — not included. Pass `--with-versions` to export every earlier wording too.",
    census.dreams === 0 ? "- `dreams/` — none: this store has no dream to export." : `- \`dreams/<year>/<date>-<id>.md\` — ${String(census.dreams)} dream${census.dreams === 1 ? "" : "s"}, one file each:` + " its journal as it was written, every change it made (undone ones marked), and the" + " reflections after it. A dream's journal is not a memory, so it is here and not in `memories/`.",
    census.reflections === 0 ? "- `reflections/` — none: this store has no reflection to export." : `- \`reflections/<year>/<date>-<id>.md\` — ${String(census.reflections)} reflection${census.reflections === 1 ? "" : "s"}, one file each:` + " what it was asked, its entry, what that entry rests on, and its morning share and what" + " became of it. An entry that cited a memory was also kept as a memory, so it is in `memories/` too.",
    "",
    "## What is NOT here",
    "",
    omitted,
    ...nightsOmitted,
    "- Removed memories. A removal is permanent; a tombstoned row has no words left to export.",
    census.notRendered.length === 0 ? "- Nothing else. Every live row, dream and reflection this export could reach is in it." : `- ${String(census.notRendered.length)} row(s) whose markdown could not be rendered: ${census.notRendered.join(", ")}.`,
    "- The structured physics — strengths, edges, the association graph, the event log, and",
    "  the records a dream keeps beside its journal (what it was shown, what undoing it needs).",
    "  Those are in the database, and `counterparts export --out <dir> --plaintext` (without",
    "  `--markdown`) copies the whole thing as one SQLite file.",
    "",
    "Nothing reads this tree back in. Editing a file here changes nothing in your store.",
    ""
  ].join(`
`);
}
function encryptedReadme(files, bytes, kind) {
  return [
    "# Counterparts export (encrypted)",
    "",
    `\`${BLOB_NAME}\` holds ${files} files (${bytes} bytes before compression) — ` + (kind === "markdown" ? "the readable markdown tree, including its own manifest." : "the whole store as one SQLite database."),
    "",
    "Format, so this is never an archive you cannot open:",
    "",
    `1. The blob is JSON: \`{format, cipher, kdf, salt, iv, tag, payload}\` — all base64.`,
    `2. Key = scrypt(passphrase, salt, N/r/p from the \`kdf\` field), ${KDF.keyBytes} bytes.`,
    `3. Payload = ${CIPHER}(gzip(JSON manifest of path -> base64 file bytes)).`,
    "",
    "The passphrase is yours and is not stored anywhere. There is no recovery path;",
    "that is the point of it being owner-keyed.",
    ""
  ].join(`
`);
}
