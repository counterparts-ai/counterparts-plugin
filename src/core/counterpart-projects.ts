/**
 * `Counterpart`'s PROJECTS (2026-10-21, wave 2 lane G, design §8): which
 * folders are one piece of work. A folder belongs to a project
 * (`folder_projects`, v14); with no row it is its own, and nothing is written
 * to say so — the wake reads `self/work.ts#projectFolders` and writes nothing.
 * A project is a SUBJECT: a card with `subject_kind` `project`, the card its
 * beliefs and tags will attach to, made only when a folder is joined.
 *
 * THE CARD (review of #572): found only among cards already a project — one
 * that has folder rows first, archived or not, so a faded card never splits
 * its project — else minted here: an entity card with the project's name as
 * its title and NO alias (`meta.name` empty, as the self subject's), so it
 * neither takes over a person's, place's or topic's card nor links every
 * memory that uses a common word ("random", "notes"). It is PROTECTED while
 * any folder belongs to it, and let go to ordinary fading when the last one
 * leaves. Lane B's tag → subject promotion may give it a name later.
 *
 * The doors: the owner's (`counterparts project join|leave`, `by: owner`) and
 * the night's proposal once he says yes (`by: night`). Bodies here, delegates
 * on the class, as `counterpart-deposit.ts`. Refusals come back as reasons,
 * never thrown; under observer every write refuses at the store's seam.
 */
import { basename } from "node:path";

import { isDirectoryScope, projectFolder } from "./self/index.js";
import type { Store } from "./store/index.js";

/** Who joined a folder (`folder_projects.via`). `default` is the folder a project was first named by. */
export type ProjectVia = "owner" | "night" | "default";

export interface ProjectView {
  /** The project's card. */
  readonly id: string;
  /** Its name, as the card holds it. */
  readonly name: string;
  readonly folders: readonly { readonly folder: string; readonly via: string }[];
}

export type JoinOutcome =
  | {
      readonly ok: true;
      readonly folder: string;
      readonly project: ProjectView;
      /** False when the folder already belonged to it. */
      readonly changed: boolean;
      /** The project it left, when it belonged to another. */
      readonly left: string | null;
      /** The card was made for this join (not found). */
      readonly born: boolean;
    }
  | { readonly ok: false; readonly reason: JoinRefusal; readonly detail: string };

export type JoinRefusal = "folder-not-a-directory" | "folder-too-wide" | "folder-is-the-store" | "project-empty" | "same-folder";

/** Every project that has a folder row, by name, each folder with who joined it. */
export function listProjects(store: Store): ProjectView[] {
  const byProject = new Map<string, { folder: string; via: string }[]>();
  for (const r of store.folderProjects()) {
    const held = byProject.get(r.project_id) ?? [];
    held.push({ folder: r.folder, via: r.via });
    byProject.set(r.project_id, held);
  }
  return [...byProject.entries()]
    .map(([id, folders]) => ({ id, name: cardName(store, id), folders }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}

/** One project's view, or null when no folder belongs to it. */
export function projectView(store: Store, id: string): ProjectView | null {
  const folders = store.folderProjects().filter((r) => r.project_id === id);
  if (folders.length === 0) return null;
  return { id, name: cardName(store, id), folders: folders.map((r) => ({ folder: r.folder, via: r.via })) };
}

/** The project `folder` belongs to, or null when it is its own (no row). */
export function projectOf(store: Store, folder: string): ProjectView | null {
  const row = store.projectOfFolder(projectFolder(folder));
  return row === null ? null : projectView(store, row.project_id);
}

function cardName(store: Store, id: string): string {
  const row = store.row(id);
  if (row === undefined) return id;
  const title = (row.title ?? "").trim();
  if (title.length > 0) return title;
  try {
    const name = store.readProse(id).meta["name"];
    if (typeof name === "string" && name.trim().length > 0) return name.trim();
  } catch {
    /* the id, below */
  }
  return id;
}

/** Why `folder` cannot be a project's folder, or null when it can. */
function badFolder(store: Store, folder: string, typed: string): { reason: JoinRefusal; detail: string } | null {
  if (!isDirectoryScope(folder)) return { reason: "folder-not-a-directory", detail: `"${typed}" is not a folder (an absolute path).` };
  if (folder === "/" || /^[A-Za-z]:[\\/]?$/.test(folder)) return { reason: "folder-too-wide", detail: `"${typed}" is the whole disk, not one piece of work.` };
  const store_ = projectFolder(store.dir);
  if (folder === store_ || folder.startsWith(`${store_}/`) || store_.startsWith(`${folder}/`)) {
    return { reason: "folder-is-the-store", detail: `"${typed}" holds the memory itself; a project's folder cannot.` };
  }
  return null;
}

/**
 * JOIN `folder` TO `project` — a project's name, or another folder, whose
 * project it joins (that folder becomes the project's first, `via: default`,
 * when it was its own, and the project is named after it).
 */
export function joinProject(
  store: Store,
  input: { readonly folder: string; readonly project: string; readonly by: Exclude<ProjectVia, "default"> },
): JoinOutcome {
  const folder = projectFolder(input.folder);
  const bad = badFolder(store, folder, input.folder);
  if (bad !== null) return { ok: false, ...bad };
  const named = input.project.trim();
  if (named.length === 0) return { ok: false, reason: "project-empty", detail: "Name a project, or a folder whose project this one joins." };
  let projectId: string;
  let born = false;
  if (isDirectoryScope(named)) {
    const anchor = projectFolder(named);
    const badAnchor = badFolder(store, anchor, input.project);
    if (badAnchor !== null) return { ok: false, ...badAnchor };
    if (anchor === folder) return { ok: false, reason: "same-folder", detail: `"${input.folder}" and "${input.project}" are the same folder; it is already its own project.` };
    const row = store.projectOfFolder(anchor);
    if (row !== null) {
      projectId = row.project_id;
    } else {
      const card = projectCard(store, basename(anchor) || anchor);
      projectId = card.id;
      born = card.born;
      store.setFolderProject(anchor, projectId, "default");
    }
  } else {
    const card = projectCard(store, named);
    projectId = card.id;
    born = card.born;
  }
  const before = store.projectOfFolder(folder);
  const changed = before?.project_id !== projectId;
  if (changed) store.setFolderProject(folder, projectId, input.by);
  holdCard(store, projectId);
  if (changed && before !== null) releaseIfEmpty(store, before.project_id);
  const project = projectView(store, projectId) as ProjectView;
  return { ok: true, folder, project, changed, left: changed && before !== null ? before.project_id : null, born };
}

/** `folder` is its own project again. `left` is null when it belonged to none. */
export function leaveProject(store: Store, folder: string): { readonly left: string | null; readonly folder: string } {
  const key = projectFolder(folder);
  const row = store.projectOfFolder(key);
  if (row === null) return { left: null, folder: key };
  store.clearFolderProject(key);
  releaseIfEmpty(store, row.project_id);
  return { left: row.project_id, folder: key };
}

/** The card is protected while a folder belongs to it: a faded card would split its project. */
function holdCard(store: Store, id: string): void {
  try {
    if (store.row(id)?.protected !== 1) store.updatePhysics(id, { protected: true });
  } catch {
    /* the rows still group by id */
  }
}

/** With no folder left, the card fades like any other. */
function releaseIfEmpty(store: Store, id: string): void {
  if (store.foldersOfProject(id).length > 0) return;
  try {
    if (store.row(id)?.protected === 1) store.updatePhysics(id, { protected: false });
  } catch {
    /* nothing held it */
  }
}

/** The project card for `name`: one that has folders, else a live project card, else one minted. */
function projectCard(store: Store, name: string): { id: string; born: boolean } {
  const key = name.trim().toLowerCase();
  const same = (id: string): boolean => cardName(store, id).trim().toLowerCase() === key;
  // A project that has folders, its card archived or not (a faded card is the same project).
  const held = [...new Set(store.folderProjects().map((r) => r.project_id))].filter(same).sort();
  if (held[0] !== undefined) return { id: held[0], born: false };
  const live = store.subjectsOfKind("project").filter(same).sort();
  if (live[0] !== undefined) return { id: live[0], born: false };
  const id = store.put({
    type: "schema",
    kind: "entity",
    title: name,
    body: `${name}: a project — the folders that are one piece of work.`,
    meta: { role: "entity", name: "", aliases: [] },
    subjectKind: "project",
    physics: { protected: true },
  });
  return { id, born: true };
}
