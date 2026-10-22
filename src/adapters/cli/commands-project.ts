/**
 * `project` — which folders are one piece of work (2026-10-21, wave 2 lane G,
 * design §8). A folder is its own project until the owner joins it to another
 * (`counterparts project join <folder> <project>`); then each folder's "Work
 * here" in the wake reads every folder of the project (`core/self/work.ts`).
 * With no words, or `list`, it reads; `join` and `leave` change it as the
 * owner, through `Counterpart.joinProject` / `leaveProject`, and refuse under
 * observer. A typed folder is resolved to the real directory the way the
 * folder setting resolves it (`scopes.ts#canonicalScopePath`), so it matches
 * the folder the hooks record a memory in.
 */
import { existsSync } from "node:fs";

import { storeExists } from "../../core/store/index.js";
import { canonicalScopePath, shortPath } from "../scopes.js";
import { EXIT, openCounterpart } from "./commands-shared.js";
import type { Io, Parsed } from "./commands-shared.js";

/** A typed project argument that names a folder rather than a project by name. */
function looksLikeFolder(word: string): boolean {
  return word.startsWith("/") || word.startsWith("~") || word.startsWith(".") || word.includes("/");
}

/** The folder as the hooks record it: resolved, real, no trailing slash. */
function folderOf(word: string, home: string): string {
  const typed = word.startsWith("~/") || word === "~" ? `${home}${word.slice(1)}` : word;
  return canonicalScopePath(typed).replace(/\/+$/, "") || "/";
}

export function projectCommand(dir: string, io: Io, parsed: Parsed, observer: boolean, namedDir: boolean, home: string): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
    return EXIT.usage;
  }
  const [verb = "list", ...args] = parsed.positional;
  if (verb === "list") {
    if (args.length > 0) {
      io.err(`refused: list takes no words — "${args.join(" ")}" is more.`);
      return EXIT.usage;
    }
    const counterpart = openCounterpart(dir, true);
    try {
      const projects = counterpart.projects();
      if (projects.length === 0) {
        io.out("Every folder is its own project. Join two with: counterparts project join <folder> <project or folder>");
        return EXIT.ok;
      }
      for (const p of projects) {
        io.out(`${p.name} (${p.id})`);
        for (const f of p.folders) io.out(`  ${shortPath(f.folder, home)}${f.via === "default" ? "" : `  — joined by ${f.via === "owner" ? "you" : "the night, on your yes"}`}`);
      }
      io.out("Any other folder is its own project.");
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  if (verb !== "join" && verb !== "leave") {
    io.err(`refused: "${verb}" is not list, join or leave.`);
    return EXIT.usage;
  }
  if (observer) {
    io.err(`refused: this console is an observer; it reads and changes nothing. Nothing was ${verb === "join" ? "joined" : "changed"}.`);
    return EXIT.refused;
  }
  if (verb === "leave") {
    const [folder, ...rest] = args;
    if (folder === undefined || rest.length > 0) {
      io.err("refused: name one folder: counterparts project leave <folder>.");
      return EXIT.usage;
    }
    const counterpart = openCounterpart(dir, observer);
    try {
      const out = counterpart.leaveProject(folderOf(folder, home));
      io.out(
        out.left === null
          ? `${shortPath(out.folder, home)} belonged to no project; it is its own, as before.`
          : `${shortPath(out.folder, home)} left its project (${out.left}); it is its own project again.`,
      );
      return EXIT.ok;
    } finally {
      counterpart.close();
    }
  }
  const [folder, project, ...rest] = args;
  if (folder === undefined || project === undefined || rest.length > 0) {
    io.err('refused: name a folder and a project: counterparts project join <folder> <project name or folder> (a name with spaces goes in quotes).');
    return EXIT.usage;
  }
  const counterpart = openCounterpart(dir, observer);
  try {
    const where = folderOf(folder, home);
    const anchor = looksLikeFolder(project) ? folderOf(project, home) : null;
    const out = counterpart.joinProject({ folder: where, project: anchor ?? project, by: "owner" });
    if (!out.ok) {
      // In the words that were typed, with the folder they resolved to (review of #572).
      const resolved = where === folder ? "" : ` (${shortPath(where, home)})`;
      io.err(`refused: counterparts project join ${folder}${resolved} ${project} — ${out.detail.replaceAll(`"${where}"`, `"${folder}"`).replaceAll(`"${anchor ?? ""}"`, `"${project}"`)} Nothing was joined.`);
      return EXIT.refused;
    }
    // A folder that is not there yet is joined all the same (it may be made
    // later), and said (review of #572).
    for (const f of [where, ...(anchor === null ? [] : [anchor])]) {
      if (!existsSync(f)) io.err(`note: ${shortPath(f, home)} does not exist (yet); its row is kept.`);
    }
    const shown = shortPath(out.folder, home);
    io.out(
      out.changed
        ? `Joined ${shown} to ${out.project.name} (${out.project.id})${out.born ? ", a new project" : ""}.`
        : `${shown} already belongs to ${out.project.name} (${out.project.id}).`,
    );
    if (out.left !== null) io.out(`  It left ${out.left}.`);
    io.out(`  ${out.project.name}: ${out.project.folders.map((f) => shortPath(f.folder, home)).join(", ")}. Each one's wake shows the work of all of them.`);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}
