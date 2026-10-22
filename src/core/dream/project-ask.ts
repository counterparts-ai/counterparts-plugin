/**
 * THE NIGHT PROPOSES A PROJECT (2026-10-21, wave 2 lane G, design §8:
 * "related folders join one project on Mike's word, or the night proposes it
 * from co-use and asks"). Mechanical, no model: two folders whose memories
 * were written on the same lived days and name the same subjects
 * (`memory_subjects`) in the last `PROJECT_JOIN_WINDOW` days look like one
 * piece of work. The reflection's finish adds ONE such pair a night to its
 * morning share as a question (`joinSentence`), keeps it on its row
 * (`detail.joinProposed`), and tells the session how to act on a yes
 * (`joinHow`): the reflect tool's phase "join" joins them, `by: night`
 * (`Counterpart.joinProject`). A no, or no answer, changes nothing, and the
 * pair rests `PROJECT_JOIN_REST` reflections before it is asked again.
 *
 * Never proposed: two folders already one project; a folder that would join
 * while it shares a project with others (a yes must never pull a folder out
 * of a project); a folder the host keeps home (`folderOn`, as the
 * reflection's other gates); the store's own folder (the nightly run's) or
 * one inside it; a GENERAL folder — one used on the same days as
 * `PROJECT_JOIN_GENERAL` others or more. A yes is honoured only while the
 * proposal still stands (`joinStillStands`): fresh, both projects as they
 * were, the folder still allowed. Lightly held; `PROJECT_JOIN_ASK` off
 * stops it. Kept apart from `reflect.ts`, as `core-ask.ts` is.
 */
import { folderName, projectFolder } from "../self/index.js";
import type { Store } from "../store/index.js";
import { DREAM_TUNABLES } from "./tunables.js";

export interface JoinProposal {
  /** The folder whose project the other joins (the busier one). */
  readonly into: string;
  /** The folder that would join it. */
  readonly folder: string;
  /** Lived days both were written in, inside the window. */
  readonly days: number;
  /** A few of the subjects both named, by name. */
  readonly subjects: readonly string[];
  /** The lived day it was proposed. */
  readonly day: number;
  /** Each folder's project when proposed (null: its own). A yes after either changed is refused. */
  readonly intoProject: string | null;
  readonly folderProject: string | null;
}

/** The key a pair rests under, either way round. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** A proposal read back from a reflection's detail, or null. */
export function joinProposalOf(raw: unknown): JoinProposal | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["into"] !== "string" || typeof r["folder"] !== "string") return null;
  const idOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    into: r["into"],
    folder: r["folder"],
    days: typeof r["days"] === "number" ? r["days"] : 0,
    subjects: Array.isArray(r["subjects"]) ? r["subjects"].filter((x): x is string => typeof x === "string") : [],
    day: typeof r["day"] === "number" ? r["day"] : Number.NEGATIVE_INFINITY,
    intoProject: idOrNull(r["intoProject"]),
    folderProject: idOrNull(r["folderProject"]),
  };
}

/** A name for the share: whitespace collapsed, capped, as `Reflections#handle`. */
function said(text: string, cap = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > cap ? `${line.slice(0, cap - 1)}…` : line;
}

/**
 * THE BEST PAIR TONIGHT, or null. `rested`: pair keys asked about lately.
 * Reads only. Never throws: a store that will not answer proposes nothing.
 */
export function proposeJoin(
  store: Pick<Store, "folderCoUse" | "projectOfFolder" | "foldersOfProject" | "dir" | "row">,
  opts: { readonly day: number; readonly rested?: ReadonlySet<string>; readonly folderOn?: (scope: string) => boolean },
): JoinProposal | null {
  const T = DREAM_TUNABLES;
  if (!T.PROJECT_JOIN_ASK) return null;
  try {
    const home = projectFolder(store.dir);
    const days = new Map<string, Set<number>>();
    const subjects = new Map<string, Map<string, number>>();
    // Distinct memories per folder (review of #580: not a row per subject).
    const written = new Map<string, Set<string>>();
    const names = new Map<string, string>();
    const shown = new Map<string, string>();
    for (const r of store.folderCoUse(opts.day - T.PROJECT_JOIN_WINDOW + 1)) {
      const f = projectFolder(r.scope);
      if (f === home || f.startsWith(`${home}/`) || home.startsWith(`${f}/`)) continue;
      (days.get(f) ?? days.set(f, new Set()).get(f) as Set<number>).add(r.day);
      (written.get(f) ?? written.set(f, new Set()).get(f) as Set<string>).add(r.id);
      if (r.subject !== null) {
        // By NAME: two cards of one name ("Apple", "Apple") are one thing here.
        const name = (names.get(r.subject) ?? names.set(r.subject, said(store.row(r.subject)?.title ?? "")).get(r.subject)) as string;
        if (name.length === 0) continue;
        const held = subjects.get(f) ?? subjects.set(f, new Map()).get(f) as Map<string, number>;
        const key = name.toLowerCase();
        held.set(key, (held.get(key) ?? 0) + 1);
        shown.set(key, name);
      }
    }
    const on = (f: string): boolean => {
      if (opts.folderOn === undefined) return true;
      try {
        return opts.folderOn(f);
      } catch {
        return false;
      }
    };
    const folders = [...days.keys()].filter((f) => (days.get(f)?.size ?? 0) >= T.PROJECT_JOIN_DAYS && on(f)).sort();
    // A SUBJECT EVERY FOLDER NAMES SAYS NOTHING ABOUT WHICH GO TOGETHER: the
    // owner, the assistant, the product everything is about. Measured on the
    // corpus copy, "Mike, Counterparts, Claude" paired every busy folder with
    // every other. Only subjects named in at most half the active folders
    // (and never fewer than two) count.
    const spread = new Map<string, number>();
    for (const f of folders) for (const s of subjects.get(f)?.keys() ?? []) spread.set(s, (spread.get(s) ?? 0) + 1);
    const telling = (s: string): boolean => (spread.get(s) ?? 0) <= Math.max(2, Math.floor(folders.length / 2));
    const tellingOf = (f: string): number => [...(subjects.get(f)?.keys() ?? [])].filter(telling).length;
    // USED ON THE SAME DAYS: at least `PROJECT_JOIN_DAYS`, and at least half
    // the days of the less-used folder — two busy folders share many days by
    // chance alone.
    const sharedDays = (a: string, b: string): number => {
      const da = days.get(a) as Set<number>;
      return [...(days.get(b) as Set<number>)].filter((d) => da.has(d)).length;
    };
    const together = (a: string, b: string): boolean => {
      const shared = sharedDays(a, b);
      const fewer = Math.min((days.get(a) as Set<number>).size, (days.get(b) as Set<number>).size);
      return shared >= T.PROJECT_JOIN_DAYS && shared * 2 >= fewer;
    };
    // A GENERAL FOLDER (review of #580, the coordinator's call): one used on
    // the same days as `PROJECT_JOIN_GENERAL` others or more is where many
    // pieces of work meet, not one of them; it is never proposed.
    const general = new Set(folders.filter((f) => folders.filter((g) => g !== f && together(f, g)).length >= T.PROJECT_JOIN_GENERAL));
    const projectOf = (f: string): string | null => store.projectOfFolder(f)?.project_id ?? null;
    /** Alone in its project: its own, or a project of one. */
    const alone = (f: string): boolean => {
      const p = projectOf(f);
      return p === null || store.foldersOfProject(p).length <= 1;
    };
    let best: (JoinProposal & { score: number }) | null = null;
    for (let i = 0; i < folders.length; i++) {
      for (let j = i + 1; j < folders.length; j++) {
        const a = folders[i] as string;
        const b = folders[j] as string;
        if (general.has(a) || general.has(b)) continue;
        if (opts.rested?.has(pairKey(a, b)) === true) continue;
        const pa = projectOf(a);
        if (pa !== null && pa === projectOf(b)) continue;
        if (!together(a, b)) continue;
        const sa = subjects.get(a) ?? new Map<string, number>();
        const sb = subjects.get(b) ?? new Map<string, number>();
        const both = [...sa.keys()].filter((s) => sb.has(s) && telling(s)).sort((x, y) => (sa.get(y) ?? 0) + (sb.get(y) ?? 0) - ((sa.get(x) ?? 0) + (sb.get(x) ?? 0)) || (x < y ? -1 : 1));
        // NAMING THE SAME THINGS: at least `PROJECT_JOIN_SUBJECTS`; at least
        // `PROJECT_JOIN_OVERLAP` of the telling subjects of the folder that
        // names fewer, and `PROJECT_JOIN_OVERLAP_MAX` of the one that names
        // more (on the corpus copy ~/random and ~/counterparts shared 0.64 of
        // the smaller; every other pair 0.25 or under).
        const smaller = Math.min(tellingOf(a), tellingOf(b));
        const larger = Math.max(tellingOf(a), tellingOf(b));
        if (both.length < T.PROJECT_JOIN_SUBJECTS || both.length < T.PROJECT_JOIN_OVERLAP * smaller || both.length < T.PROJECT_JOIN_OVERLAP_MAX * larger) continue;
        // The less-written folder joins the busier one's project — only when
        // it is alone in its own: a yes never pulls a folder out of a project.
        const [into, folder] = (written.get(a)?.size ?? 0) >= (written.get(b)?.size ?? 0) ? [a, b] : [b, a];
        if (!alone(folder)) continue;
        const shared = sharedDays(a, b);
        const score = shared * both.length;
        if (best !== null && score <= best.score) continue;
        best = {
          into,
          folder,
          days: shared,
          subjects: both.slice(0, 3).map((k) => shown.get(k) ?? k),
          day: opts.day,
          intoProject: projectOf(into),
          folderProject: projectOf(folder),
          score,
        };
      }
    }
    if (best === null) return null;
    const { score: _score, ...proposal } = best;
    return proposal;
  } catch {
    return null;
  }
}

/**
 * DOES A YES STILL MEAN WHAT IT SAID (review of #580)? Null when the
 * proposal may be acted on now; else the reason and a sentence. Refused: one
 * older than `PROJECT_JOIN_EXPIRE_DAYS` lived days; one where either folder's
 * project changed since; one whose folder the host now keeps home.
 */
export function joinStillStands(
  store: Pick<Store, "projectOfFolder">,
  p: JoinProposal,
  opts: { readonly day: number; readonly folderOn?: (scope: string) => boolean },
): { readonly reason: string; readonly detail: string } | null {
  if (opts.day - p.day > DREAM_TUNABLES.PROJECT_JOIN_EXPIRE_DAYS) {
    return { reason: "proposal-expired", detail: `The question was asked on lived day ${String(p.day)}; it is now ${String(opts.day)}, too long ago to act on. The night may ask again.` };
  }
  const now = (f: string): string | null => store.projectOfFolder(f)?.project_id ?? null;
  if (now(p.into) !== p.intoProject || now(p.folder) !== p.folderProject) {
    return { reason: "projects-changed", detail: `${said(folderName(p.folder))} or ${said(folderName(p.into))} has joined or left a project since the question was asked.` };
  }
  if (opts.folderOn !== undefined) {
    let ok = false;
    try {
      ok = opts.folderOn(p.folder) && opts.folderOn(p.into);
    } catch {
      ok = false;
    }
    if (!ok) return { reason: "folder-kept-home", detail: `The host now keeps ${said(folderName(p.folder))} or ${said(folderName(p.into))} to itself.` };
  }
  return null;
}

/** The share's question, in the counterpart's voice. */
export function joinSentence(p: JoinProposal): string {
  const things = p.subjects.map((x) => said(x, 40)).filter((x) => x.length > 0);
  const folder = said(folderName(p.folder));
  const into = said(folderName(p.into));
  return (
    `${folder} and ${into} look like one piece of work: written in on the same ${String(p.days)} days lately` +
    `${things.length > 0 ? `, both about ${things.join(", ")}` : ""}. Shall I treat them as one project? ` +
    `Then all of ${folder}'s work would show in ${into}'s wake, and all of ${into}'s in ${folder}'s. ` +
    `If you'd rather not, I won't ask about these two again for a while.`
  );
}

/** How the session acts on the owner's answer. */
export function joinHow(reflection: string, p: JoinProposal, who: string): string {
  return (
    `The share asks ${who} whether ${said(folderName(p.folder))} and ${said(folderName(p.into))} are one project: ask it plainly, and mark the share told. ` +
    `On ${who}'s yes, the counterparts reflect tool's phase "join", reflection: ${reflection}, joins them. On a no, or no answer, nothing changes.`
  );
}
