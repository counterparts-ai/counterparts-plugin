/**
 * THE DESTRUCTION PATH. It lives here, in the owner's console, and nowhere else.
 *
 * `src/core/store/owner-op-seam.ts` declares `OwnerRemovalPort` as TYPES ONLY —
 * the store exports no delete, no unlink, no rm, and that absence is the
 * enforcement (§5 G2, §16 G1). This file is the one implementation. A test in
 * `test/cli.test.ts` walks the import graph and fails if any core module, any
 * other adapter, or anything a model can reach imports it. **That test failing
 * is the point**: it is the caller-universality check the contract asks for
 * (§16 G2, earned-mechanism #14).
 *
 * The order below is not style. Every step is a crash point, and at every one of
 * them the memory is either fully alive, or dark AND RECORDED (§16 G10–G11):
 *
 *   1. **Validate the target.** Memory-bearing roots only (§16 G16). The
 *      archive, the backups, the graph and the removal record itself are never
 *      nameable, so a typo cannot point removal at the record of removal.
 *   2. **Read everything that must be read, BEFORE anything is chased** (§16
 *      G13). v1 named this bug by making it: chasing copies first left every
 *      span unidentifiable, so the contamination scan had nothing to match on.
 *      The scan returns **ids only** — printing the matches would re-leak
 *      exactly what is being erased (§16 G15).
 *   3. **`requested`.** If the record cannot be written, NOTHING MOVES. A
 *      removal that happened without a record is the one outcome worse than a
 *      removal that did not happen.
 *   4. **`dark`.** From this moment `Store.deniedIds()` contains the id, and
 *      every consumer that consults it — recall, sleep, associate, prospective,
 *      the cache rebuild — skips it. A restored backup or a stray copy cannot
 *      quietly resurrect it; the stray is skipped and LOGGED, never deleted
 *      (§16 G12).
 *   5. **Chase**, then `chased`, then `complete`. Whatever could not be chased
 *      is REPORTED, never silently dropped (§16 G15: no silent partial success).
 *      The raw-capture buffer under `spans/` is chased here, because it is
 *      `remember/`'s state machine and not this module's to unlink; box 2 (the
 *      row, its BODY and every archived version's body, its edges, its
 *      prospective windows, the gate rows that name it, and every content
 *      pointer it had) by `chaseRemoved` on the store's owner-op seam, which
 *      appends the `chased` stage inside its own transaction; box 3 by a
 *      rebuild that skips and logs the denied id. *(Until the floor — schema
 *      v6, 2026-09-20 — there was a box 1 to chase here as well: the memory's
 *      prose file and every archived version file. The words are columns now,
 *      so they go with the row, in one transaction; see `reclaim` below for
 *      what that costs.)*
 *
 * The record carries no body and no content hash (§16 G9, scar §2.20): a hash of
 * low-entropy content is brute-forceable, which would make the record of a
 * removal a leak of the thing removed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The span buffer's OWN scope-directory function, imported rather than
// re-derived: `spans/<keyFor(scope)>/` is `remember/`'s layout, and a second
// copy of that arithmetic living in the destruction path is how a report starts
// naming a file that does not exist.
import { SpanBuffer, keyFor } from "../../core/remember/index.js";
// The buffer's own destruction seam — the second VALUE import this file makes
// from core, and pinned by the same caller-universality test as the first. The
// strike is `remember/`'s because `spans/` is `remember/`'s state machine: an
// `rmSync` from here would race a claim renaming the file aside, which is the
// one state spec §2 G6 forbids (cli/INTERFACE-GAPS §9, closed 2026-09-05).
import { strikeSpans } from "../../core/remember/owner-strike-seam.js";
// The journal's markdown copy is a SURFACE (F6): a derived file under
// `<store>/journal/` holding an episode's words. `syncJournalCopy` is imported
// rather than an `rmSync` from here for the same reason `strikeSpans` is — the
// directory belongs to `self/`, and the invariant it keeps ("a file exists
// exactly when a live episode row does") is what makes the chase provable.
import { journalFilesFor, syncJournalCopy } from "../../core/self/journal-file.js";
import { paths, rowTombstoned } from "../../core/store/index.js";
import { isLocked, openDb } from "../../core/store/db.js";
import type {
  OwnerRemovalOutcome,
  OwnerRemovalRequest,
  RemovalNote,
  Store,
} from "../../core/store/index.js";
// The one VALUE imported from the seam, and the reason the caller-universality
// test pins this file AND that one: `chaseRemoved` is the box-2 half of the
// destruction path. It is reachable by importing the seam on purpose, never by
// holding a `Store` (INTERFACE-GAPS §1, closed 2026-08-25).
import { chaseRemoved } from "../../core/store/owner-op-seam.js";
// The page has its own door out (`self-page --clear`), and removal is not it.
import { isSelfPageRow } from "../../core/self/page.js";

export interface RemovalPlan {
  readonly targetId: string;
  readonly valid: boolean;
  readonly reason: "ok" | "unknown-id" | "not-memory-bearing" | "already-removed" | "is-the-self-page";
  /** IDS ONLY. Other memories whose text overlaps the doomed content (§16 G15). */
  readonly contamination: readonly string[];
  /** What the chase will visit, by surface name. Counts, never contents. */
  readonly surfaces: { readonly surface: string; readonly count: number }[];
  /**
   * The SEVENTH surface: `remember/`'s raw capture buffer. Always present, in
   * all three states — a surface that is silent when it is empty is exactly the
   * silent partial success §16 G15 forbids. Since 2026-09-05 `held` is CHASED,
   * through `remember/`'s own strike seam, and `unknown` is the one state that
   * still lands in `unchasable`.
   */
  readonly spans: SpanSurface;
  /**
   * The chase key, carried from the plan to the run so the strike does not have
   * to re-derive it after the prose is gone. Hashes and a scope — never the
   * body, which stays a local in `planRemoval` and reaches the seam only as a
   * predicate the caller closes over.
   */
  readonly spanChase: SpanChase;
  /** Surfaces this implementation cannot reach — named, never implied. */
  readonly unchasable: readonly string[];
  /**
   * Lines this removal LEAVES on purpose, said in their own words. Not
   * `unchasable`: nothing failed, and filing them under "dark via the deny-list"
   * described a conversation turn as though it had an id and a tombstone
   * (review F6).
   */
  readonly leftAlone: readonly string[];
}

/**
 * `held` — a line under `spans/` carries this memory's words, right now, checked.
 * `unknown` — this console cannot rule it out, and says which way it is blind.
 * `not-applicable` — checked, and there is nothing of this memory there.
 */
export type SpanState = "held" | "unknown" | "not-applicable";

export interface SpanSurface {
  readonly surface: "spans";
  readonly state: SpanState;
  /** Store-RELATIVE, and only when one can be named. Never an absolute path. */
  readonly path: string | null;
  /** Lines the strike will take, counted at plan time. Zero unless `held`. */
  readonly count: number;
  /**
   * OTHER lines under `spans/` that quote these words without being this
   * memory's own capture — the conversation turn in which they were said,
   * still waiting to be interpreted. They are LEFT, on purpose: a conversation
   * span is many turns joined, belongs to no single memory, and striking it
   * because one memory quoted it would destroy material nobody named. Counted
   * and disclosed rather than passed over in silence (§16 G15).
   */
  readonly echoes: number;
  /**
   * HOW the memory's own line was identified — printed, because the two are not
   * equally strong and a reader deciding whether to confirm deserves to know
   * which one is about to run (review F4). `hash` is the identity the mint
   * recorded. `content` is a jot whose FULL text equals the doomed body.
   */
  readonly matchedBy: "hash" | "content" | "none";
  /**
   * The scope-unknown content case, refused rather than performed (review F4).
   * A migrated row carries `origin: { ref }` and NO scope, so a content chase
   * would have to visit every project on the machine. These are the jot lines
   * that would have matched, named as files and counts — no text, no strike —
   * so the owner can look and decide. `--strike-by-content-across-scopes`
   * performs it.
   */
  readonly candidates: readonly { readonly file: string; readonly lines: number }[];
  /** The whole sentence the console prints, and the `unchasable` entry when it is one. */
  readonly line: string;
}

/**
 * How the buffer is addressed. `hashes` is the chase BY IDENTITY — the span
 * hash the mint recorded in the memory's prose meta (`origin.spanHash`), plus
 * every `own: true` coverage mark for its `origin_ref`, which is what makes the
 * chase work on rows minted before that meta key existed. `byContent` says the
 * console had no hash and will match on the doomed body instead.
 */
export interface SpanChase {
  readonly scope: string | null;
  readonly hashes: readonly string[];
  /** True when the strike will match on the body. EXACT-LINE equality on a jot,
   *  never a substring, and never outside `scope` unless the owner passed
   *  `--strike-by-content-across-scopes` (review F4). */
  readonly byContent: boolean;
}

/** What `planRemoval` was told the owner asked for. */
export interface PlanOptions {
  /**
   * The owner's explicit say-so for the one chase this console refuses by
   * default: matching a body across EVERY scope on the machine, for a row whose
   * provenance never recorded which project it came from.
   */
  crossScopeContent?: boolean;
  /** How many episodes the journal-echo check reads. Injectable so a test can
   *  prove the bound is REPORTED rather than silent. */
  echoScanMax?: number;
}

export interface RemovalOptions extends PlanOptions {
  /** Wall-clock, not lived days: a week away must still be a week of second
   *  thoughts (§16's note on the released ceremony). */
  now?: () => number;
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}

/** Prose families a removal may target. Everything else is chased, never named. */
const MEMORY_BEARING = new Set(["memory", "episode", "schema"]);

/** Everything `planRemoval` can say instead of `ok`. */
export type RemovalRefusal = Exclude<RemovalPlan["reason"], "ok">;

/**
 * IS THIS ID REMOVABLE AT ALL — step 1 on its own, and nothing after it.
 *
 * Extracted 2026-09-22 for the console's interactive picker, which has to ask
 * the question twice before anything is planned: once to decide which search
 * hits it may OFFER, and once over what the person picked, before the single
 * confirmation. Both of those run over several ids at a time, and step 2 —
 * reading the body, the contamination scan, the bounded journal-echo pass — is
 * the expensive half of a plan and answers a question nobody has asked yet.
 *
 * It is an EXTRACTION, not a second rule: `planRemoval` calls this and nothing
 * else decides its refusals, so a candidate the picker offers is a candidate the
 * plan accepts. Pure, like the plan: it writes nothing and takes no lock.
 */
export function removalRefusal(store: Store, targetId: string): RemovalRefusal | null {
  const row = store.row(targetId);
  if (row === undefined) return "unknown-id";
  if (!MEMORY_BEARING.has(row.type)) return "not-memory-bearing";
  if (store.deniedIds().includes(targetId)) return "already-removed";
  // THE SELF PAGE IS NOT REMOVED, IT IS CLEARED (2026-09-18, S1, and the
  // adversarial review that found the dead end). Removal tombstones a row —
  // blank body, blank content hash, id on the deny-list, row still listed — and
  // `schemas/` reads every `type: "schema"` row at open, so removing the page
  // (or the identity core, which has had the same exposure since it shipped)
  // left a store that would not open at all, with the wake hook swallowing the
  // error so the symptom was silence.
  //
  // *(The floor, 2026-09-20, closed the crash half of that: `Schemas.load`
  // SKIPS a tombstoned row and counts it, so a removed page no longer takes the
  // session down. Everything below still holds and is why this door stays —
  // removal is permanent and the page is the one schema row the owner is
  // guaranteed to have, so sending him to `--clear` is about being able to put
  // it back, not only about the store opening.)*
  //
  // The page is also the most conspicuous schema row an owner has:
  // `enumerate()` lists it and `status` prints its id. So the console sends him
  // one door along, to the one that keeps the page as a version and lets him
  // put it back.
  if (isSelfPageRow(store, targetId)) return "is-the-self-page";
  return null;
}

/**
 * The one state still unreachable, in the same words wherever it is reported.
 * Kept as a constant for the reason it was written as one: a blind spot
 * described two different ways in two places is a blind spot nobody can grep.
 */
const SPANS_BLIND =
  "this removal did not reach it, and a later backup would copy it (export would not).";

/**
 * The journal surface's own blind sentence, for the same reason `SPANS_BLIND`
 * is one: a directory that still holds the words after a chase said it was
 * clean is a fact the owner must be handed, in the same words wherever it is
 * printed. (It is no longer in the backup set — see `olderCopiesNote` — so the
 * sentence is about this store's own disk, not about future copies.)
 */
const JOURNAL_STILL_THERE =
  "journal/ — it is a derived copy, and deleting that file by hand loses nothing";

/**
 * WHAT A REMOVAL CANNOT REACH: the copies already on disk.
 *
 * F6 did not create this gap — every snapshot has always held whatever the
 * store held when it was taken — but it changed its severity by a wide margin
 * and nothing said so (f6f7 review MAJOR-5). A removed memory inside an old
 * snapshot's DATABASE is a file somebody must know to open; the same words in
 * an old snapshot's `journal/*.md` are a grep hit, a Spotlight result, a synced
 * folder's problem.
 *
 * Two things make this sentence honest rather than alarming, and both are said:
 * snapshots taken FROM TODAY carry no `journal/` at all (it left the backup set
 * in the same change), and a snapshot is the owner's own file to delete.
 *
 * It names the DEFAULT snapshot directory and counts what is in it. The console
 * reads no host configuration, so a configured `snapshots.dir` is not visible
 * from here — the sentence says so rather than implying the default is the
 * whole story.
 */
function olderCopiesNote(storeDir: string): string {
  const snapshots = join(storeDir, "..", "snapshots");
  let copies = 0;
  try {
    copies = readdirSync(snapshots).length;
  } catch {
    /* none, or not readable from here: the sentence still holds */
  }
  return (
    `snapshots and backups TAKEN BEFORE TODAY still hold these words, and the journal ones hold them as plain markdown` +
    (copies === 0
      ? ` — none in the default location (${relative(storeDir, snapshots)}), and a location set in your host configuration is not visible from this console.`
      : ` — ${copies} cop${copies === 1 ? "y" : "ies"} in the default location (${relative(storeDir, snapshots)}), plus anywhere else you have taken one.`) +
    " A removal does not reach into them; they are yours to delete. Snapshots taken from today carry no journal/ at all."
  );
}

/**
 * Every `*.jsonl` under a directory — the live streams and the claims beside
 * them — AND every `*.jsonl.striking` aside (review F1).
 *
 * An aside is a crashed strike's survivors, and it sits off every path the
 * buffer itself reads. Missing it here meant a later `remove` reported "not
 * applicable" while the words were on disk and `backup` copied them — the
 * silent partial success this whole surface exists to prevent. The strike's own
 * recovery pass folds any aside back before it runs, so naming it here is not
 * a promise the chase cannot keep.
 */
function jsonlUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".jsonl") || name.endsWith(".jsonl.striking")) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Does this file hold a line of this memory? BY HASH first — the identity the
 * mint recorded — and by the doomed TEXT only as the fallback for a row minted
 * before the provenance existed. Reads the file; never returns a word of it.
 *
 * Only lines that are SPANS count. `coverage.jsonl`, `consumed.jsonl` and
 * `failures.jsonl` carry span hashes too, and matching a hash there would report
 * a file that holds nothing but bookkeeping as one that holds the owner's words.
 */
function spanLinesIn(
  path: string,
  hashes: ReadonlySet<string>,
  needle: string | null,
): { byHash: number; byTextJot: number; byTextOther: number } {
  const none = { byHash: 0, byTextJot: 0, byTextOther: 0 };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return none;
  }
  let byHash = 0;
  let byTextJot = 0;
  let byTextOther = 0;
  let parsedAny = false;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const record = JSON.parse(line) as { text?: unknown; hash?: unknown; kind?: unknown };
      if (typeof record.text !== "string") continue;
      parsedAny = true;
      if (typeof record.hash === "string" && hashes.has(record.hash)) byHash += 1;
      else if (needle !== null && record.text.includes(needle)) {
        // A text match is only ever this MEMORY's own line when the span is a
        // JOT — the words deposited as themselves — and when its WHOLE text is
        // the body, not merely a stretch containing it. Substring matching is
        // what turned removing "buy milk" into the destruction of two unrelated
        // jots in two unrelated projects (review F4): a jot reading "buy milk
        // and call the vet" contains the doomed words and is somebody else's
        // memory. Everything short of full equality is an echo, and a record
        // with no `kind` is an echo too — the conservative direction is the one
        // that destroys nothing.
        if (record.kind === "jot" && record.text.trim() === needle) byTextJot += 1;
        else byTextOther += 1;
      }
    } catch {
      /* a half-written line: covered by the raw check below */
    }
  }
  // The raw substring is what catches a file this console does not understand —
  // a format change, a half-written line. It counts as an ECHO, never as a line
  // to strike: this console did not manage to identify it.
  if (byHash === 0 && byTextJot === 0 && byTextOther === 0 && !parsedAny && needle !== null && text.includes(needle)) {
    return { byHash: 0, byTextJot: 0, byTextOther: 1 };
  }
  return { byHash, byTextJot, byTextOther };
}

/**
 * THE CHASE KEY. Two sources, both already durable, neither of them the body:
 *
 *   1. `origin.spanHash` in the memory's PROSE META. The mint records it for
 *      every jot (`core/mint.ts`), and it lives in the prose rather than in a
 *      box-2 column on purpose — a hash of low-entropy content is
 *      brute-forceable (§16 G9), so the pointer must die with the document it
 *      points at instead of outliving the removal in the row skeleton.
 *   2. The `own: true` COVERAGE MARKS for this memory's `origin_ref`. Every
 *      accepted proposal writes `{spanHash, proposalId, own}` into the scope's
 *      `coverage.jsonl`, and the mint stores the proposal id in `origin_ref` —
 *      so the link from a memory to the span it WAS has been on disk since long
 *      before this feature, and the chase works on rows minted before it.
 *
 * `own` is the whole filter. The other spans a proposal covered are the
 * conversation AROUND it, which belong to no single memory; striking those
 * because one memory cited them would be a destruction nobody asked for.
 */
function chaseHashes(store: Store, doc: { meta?: Record<string, unknown> } | null, row: {
  origin_scope?: unknown;
  origin_ref?: unknown;
} | undefined): { scope: string | null; hashes: string[] } {
  const scope =
    typeof row?.origin_scope === "string" && row.origin_scope.length > 0 ? row.origin_scope : null;
  const hashes = new Set<string>();

  const origin = doc?.meta?.["origin"];
  if (origin !== null && typeof origin === "object") {
    const spanHash = (origin as { spanHash?: unknown }).spanHash;
    if (typeof spanHash === "string" && spanHash.length > 0) hashes.add(spanHash);
  }

  const ref = typeof row?.origin_ref === "string" && row.origin_ref.length > 0 ? row.origin_ref : null;
  if (ref !== null && scope !== null) {
    const coverage = join(store.dir, "spans", keyFor(scope), "coverage.jsonl");
    if (existsSync(coverage)) {
      let text = "";
      try {
        text = readFileSync(coverage, "utf8");
      } catch {
        text = "";
      }
      for (const line of text.split("\n")) {
        if (line.trim().length === 0) continue;
        try {
          const mark = JSON.parse(line) as { spanHash?: unknown; proposalId?: unknown; own?: unknown };
          if (mark.own !== true) continue;
          if (mark.proposalId !== ref) continue;
          if (typeof mark.spanHash === "string") hashes.add(mark.spanHash);
        } catch {
          /* an unreadable mark is not a hash */
        }
      }
    }
  }

  return { scope, hashes: [...hashes] };
}

/**
 * THE SEVENTH SURFACE (LAUNCH-STATUS §I2; option A shipped 2026-09-04, option B
 * — the chase — on 2026-09-05).
 *
 * A note taken through the MCP `note` tool or `counterparts note` is CAPTURED
 * first — `captureJot` appends the verbatim text to `spans/<keyFor(scope)>/jots.jsonl` —
 * and minted second. The chase never reached that file, `unchasable` was a
 * hardcoded `[]`, and `remove` reported `unchased: nothing` while the words were
 * still on disk. It reaches it now, through `remember/`'s own strike seam.
 *
 * **Identity first, evidence second, provenance third.** The state is decided by
 * looking: the memory's own span hash (from the mint) and then its words are
 * searched for in the buffer files, and a hit is a fact rather than an
 * inference. The hash is what lets the chase work when the prose is already
 * gone, which is the case the content search could never answer. Provenance only
 * breaks the tie when both come back empty — because `source = 'authored'` means
 * this memory came through the jot door, and "I did not find it" is not "it was
 * never there". The remaining blind spot (prose gone AND no hash recorded) is
 * reported as `unknown` rather than resolved in the comfortable direction.
 */
export function spanResidue(
  store: Store,
  targetId: string,
  body: string,
  hashes: readonly string[] = [],
  opts: PlanOptions = {},
): SpanSurface {
  const row = store.row(targetId);
  const source = typeof row?.source === "string" && row.source.length > 0 ? row.source : null;
  const scope = typeof row?.origin_scope === "string" && row.origin_scope.length > 0 ? row.origin_scope : null;
  const spansRoot = join(store.dir, "spans");
  const scopeDir = scope === null ? spansRoot : join(spansRoot, keyFor(scope));
  const files = jsonlUnder(scopeDir);
  const rel = (path: string): string => relative(store.dir, path);
  const named = scope === null ? "spans/" : `${rel(scopeDir)}/`;

  const none = (state: SpanState, line: string, extra: Partial<SpanSurface> = {}): SpanSurface => ({
    surface: "spans",
    state,
    path: null,
    count: 0,
    echoes: 0,
    matchedBy: "none",
    candidates: [],
    line,
    ...extra,
  });

  if (files.length === 0) {
    return none(
      "not-applicable",
      `spans: not applicable — there is no capture buffer at ${named} for this memory, so nothing of it rode one.`,
    );
  }

  const needle = body.trim().length > 0 ? body.trim() : null;
  const keys = new Set(hashes);

  // THE CONTENT CHASE IS SCOPED (review F4). A hash names one span anywhere; a
  // BODY names a shape, and a shape matched across every project on the machine
  // is how removing one memory reaches into another person's work. Migrated rows
  // are exactly this case — `tools/migrate/apply.ts` writes `origin: { ref }`
  // with no scope at all — so this is not a hypothetical about a rare row, it is
  // the shape of ~12,000 of them. Without a recorded scope the console REFUSES
  // to strike by content and lists what it would have matched instead.
  const contentAllowed = keys.size === 0 && needle !== null;
  const contentScoped = contentAllowed && (scope !== null || opts.crossScopeContent === true);

  // ONE pass over the buffer, three numbers out of it.
  //
  //   `count`      — lines the strike will take.
  //   `echoes`     — other lines carrying these words: the conversation they
  //                  were said in, or a longer jot that quotes them. LEFT,
  //                  because they belong to no single memory — and SAID,
  //                  because a grep will find them (§16 G15).
  //   `candidates` — the scope-unknown content case: jot lines whose whole text
  //                  IS the body, somewhere on this machine. Named, not struck.
  let count = 0;
  let echoes = 0;
  let first: string | null = null;
  const candidates: { file: string; lines: number }[] = [];
  for (const file of files) {
    const hits = spanLinesIn(file, keys, needle);
    const exact = keys.size > 0 ? 0 : hits.byTextJot;
    const mine = keys.size > 0 ? hits.byHash : contentScoped ? hits.byTextJot : 0;
    echoes += keys.size > 0 ? hits.byTextJot + hits.byTextOther : hits.byTextOther;
    if (!contentScoped && exact > 0) candidates.push({ file: rel(file), lines: exact });
    if (mine === 0) continue;
    count += mine;
    if (first === null) first = rel(file);
  }

  /** The disclosure sentence, appended to whatever verdict the state reaches. */
  const echoNote =
    echoes === 0
      ? ""
      : ` ${echoes} line${echoes === 1 ? "" : "s"} of conversation under ${named} quote${echoes === 1 ? "s" : ""} these words — transcript, not this memory's own capture, and left alone here; retention deletes a session's captured text 7 days after it ends, unless it is still waiting to be written up, so ${echoes === 1 ? "it goes" : "they go"} then (the daily snapshots keep a copy up to 14 days longer).`;

  if (first !== null) {
    const where = count === 1 ? first : `${first} (and ${count - 1} more line${count === 2 ? "" : "s"})`;
    const how =
      keys.size > 0
        ? "matched by the span hash its mint recorded"
        : opts.crossScopeContent === true && scope === null
          ? "matched by content across every scope, on your say-so (--strike-by-content-across-scopes)"
          : "matched by content — a jot whose whole text is this memory's body";
    return {
      surface: "spans",
      state: "held",
      path: first,
      count,
      echoes,
      matchedBy: keys.size > 0 ? "hash" : "content",
      candidates: [],
      line: `${where} — the raw capture buffer holds this memory's words (${how}); the removal strikes them out of it.${echoNote}`,
    };
  }

  // The refusal, and what it is refusing: named files and counts, never a word
  // of what is in them (§16 G15). The owner can look, and can override.
  if (candidates.length > 0) {
    const total = candidates.reduce((n, c) => n + c.lines, 0);
    const where = candidates.map((c) => `${c.file} (${c.lines})`).join(", ");
    return {
      surface: "spans",
      state: "unknown",
      path: named,
      count: 0,
      echoes,
      matchedBy: "none",
      candidates,
      line: `${named} — this memory's provenance records no scope and no span hash, so a chase by content would have to visit EVERY project on this machine. NOT done: ${total} jot line${total === 1 ? "" : "s"} whose whole text is this memory's body would have matched, in ${where}. Look, then re-run with --strike-by-content-across-scopes if they are yours to remove; until then ${SPANS_BLIND}${echoNote}`,
    };
  }

  if (needle === null && keys.size === 0) {
    return none(
      "unknown",
      `${named} — the prose is already gone and no span hash was recorded, so this console cannot tell whether the words rode the buffer; if they did, ${SPANS_BLIND}${echoNote}`,
      { echoes, path: named },
    );
  }

  // Searched — by hash where there was one, by content where that was allowed —
  // and this memory's own line is not there. Whether that settles it depends on
  // how the memory was minted.
  if (keys.size > 0) {
    return none(
      "not-applicable",
      echoes === 0
        ? `spans: not applicable — this memory's own span is named in its provenance, and no line under ${named} still carries it.`
        : `spans: not applicable — this memory's own capture is already gone from ${named}.${echoNote}`,
      { echoes },
    );
  }
  if (source === "authored") {
    return none(
      "unknown",
      `${named} — this memory came through the jot door, so its words rode the buffer; no jot there matches them now, and this console cannot prove the capture is gone; if one survives, ${SPANS_BLIND}${echoNote}`,
      { echoes, path: named },
    );
  }
  if (source === null) {
    return none(
      "unknown",
      `${named} — unknown whether the words rode the buffer: this memory's provenance was never recorded, and a buffer exists; if a jot is there, ${SPANS_BLIND}${echoNote}`,
      { echoes, path: named },
    );
  }
  return none(
    "not-applicable",
    `spans: not applicable — a '${source}' memory is not captured as a jot, and no jot under ${named} holds its words.${echoNote}`,
    { echoes },
  );
}

/**
 * How many episodes the echo check reads before it stops and says so.
 *
 * It reads bodies, which is the expensive thing this console does — but removal
 * is a rare, deliberate owner operation and the alternative is the failure this
 * bound exists to replace. A store past this many episodes gets a REPORTED
 * partial check rather than a silent one.
 */
export const JOURNAL_ECHO_SCAN_MAX = 2_000;

export interface JournalEcho {
  /** Episode ids whose chapters hold these words. Ids only (§16 G15). */
  readonly ids: readonly string[];
  /** Episodes actually read, and how many exist. Equal ⇒ the check was whole. */
  readonly checked: number;
  readonly total: number;
}

/** Whitespace-folded, so a chapter that wrapped a sentence differently from the
 *  memory minted out of it is still recognised as holding it. */
function folded(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * WHICH EPISODES HOLD THESE WORDS — asked exactly, not ranked.
 *
 * This used to read the `contamination` list, which is `store.search(body, 20)`:
 * a ranked top-20 full-text search. Measured by the f6f7 review (MAJOR-3): with
 * twenty-five near-identical memories — the ordinary shape of a store that has
 * thought about one subject for a while — the episode fell off the end of the
 * list, and the report printed `chase journal: 0`, `journal(0, nothing beside
 * the row)` and `unchased: nothing` while a plain `.md` under the store still
 * held the removed sentence. That is F5 review-B MAJOR-1's shape one directory
 * over, with an FTS rank as the only thing between this console and it.
 *
 * Two questions, cheapest first:
 *
 *   1. **The exact link.** A memory minted from an episode carries
 *      `meta.episodeId` (`self/episodes.ts` writes it; `memoriesForEpisode`
 *      reads it). One field, no scan, no ambiguity.
 *   2. **The containment scan**, for the un-linked "quotes these words" case:
 *      every `type: "episode"` row, whitespace-folded, asked whether it holds
 *      the doomed body. Bounded by `JOURNAL_ECHO_SCAN_MAX`, and the bound is
 *      REPORTED — a stated bound is survivable, a silent one is not.
 *
 * The episodes' markdown copies say exactly what their rows say, so an answer
 * about the rows is an answer about the files.
 */
function journalEcho(
  store: Store,
  targetId: string,
  body: string,
  doc: { meta?: Record<string, unknown> } | null,
  opts: PlanOptions,
): JournalEcho {
  const ids: string[] = [];
  const linked = doc?.meta?.["episodeId"];
  if (typeof linked === "string" && linked.length > 0 && linked !== targetId) {
    const row = store.row(linked);
    if (row !== undefined && row.type === "episode" && !rowTombstoned(row)) ids.push(linked);
  }
  const needle = folded(body);
  let episodes: string[];
  try {
    episodes = store.list({ type: "episode" });
  } catch {
    return { ids, checked: 0, total: 0 };
  }
  if (needle.length === 0) return { ids, checked: episodes.length, total: episodes.length };
  const cap = Math.max(0, opts.echoScanMax ?? JOURNAL_ECHO_SCAN_MAX);
  let checked = 0;
  for (const id of episodes) {
    if (checked >= cap) break;
    checked += 1;
    if (id === targetId || ids.includes(id)) continue;
    try {
      const row = store.row(id);
      if (row === undefined || rowTombstoned(row)) continue;
      if (folded(store.readProse(id).body).includes(needle)) ids.push(id);
    } catch {
      /* a row that will not read cannot be claimed either way */
    }
  }
  return { ids, checked, total: episodes.length };
}

/**
 * STEP 1 + 2: validate, then read everything the removal will need. Pure — it
 * writes nothing and takes no lock, so it is safe to run before a confirmation
 * prompt and safe to run again after one (scar §2.13's re-plan-under-the-lock
 * rule; E5's never-hold-a-lock-across-a-human-prompt rule).
 */
export function planRemoval(
  store: Store,
  targetId: string,
  opts: PlanOptions = {},
): RemovalPlan {
  const none = (reason: RemovalPlan["reason"]): RemovalPlan => ({
    targetId,
    valid: false,
    reason,
    contamination: [],
    surfaces: [],
    // An invalid target is not a memory to have residue: nothing was read and
    // nothing is claimed about the buffer.
    spans: {
      surface: "spans",
      state: "not-applicable",
      path: null,
      count: 0,
      echoes: 0,
      matchedBy: "none",
      candidates: [],
      line: "spans: not applicable — there is nothing here to have ridden the buffer.",
    },
    spanChase: { scope: null, hashes: [], byContent: false },
    unchasable: [],
    leftAlone: [],
  });

  // STEP 1, through the seam the console's picker asks through, so the two
  // cannot drift: an id this turns away is one the picker never offered.
  const refusal = removalRefusal(store, targetId);
  if (refusal !== null) return none(refusal);
  const row = store.row(targetId);
  // `removalRefusal` has just proved there is one; this is the narrowing, and
  // the arm is unreachable rather than defensive.
  if (row === undefined) return none("unknown-id");

  // EVERYTHING THAT READS THE DOOMED CONTENT HAPPENS HERE (§16 G13).
  let body = "";
  let doc: { meta?: Record<string, unknown> } | null = null;
  try {
    const read = store.readProse(targetId);
    body = read.body;
    doc = read;
  } catch {
    // The prose is already gone. The removal still proceeds — the row, the
    // graph and the deny-list entry are the rest of the surface, and the span
    // hash is still reachable through `origin_ref` and the coverage marks.
  }
  const chase = chaseHashes(store, doc, row);
  const contamination: string[] = [];
  if (body.trim().length > 0) {
    for (const hit of store.search(body, 20)) {
      if (hit.id !== targetId) contamination.push(hit.id);
    }
  }

  const versions = store.versions(targetId);
  const edges = store.edgesFrom(targetId);
  const prospective = store.prospectiveFor(targetId);
  // Read WITH the rest (§16 G13): the buffer is searched for this memory's span
  // before anything is chased, because after the chase there is nothing left to
  // search for. Counts and states come out; not one line of what it read.
  const spans = spanResidue(store, targetId, body, chase.hashes, opts);
  // THE JOURNAL'S MARKDOWN COPY (F6). Two different questions, and they get
  // two different answers:
  //   - this memory's OWN file — an episode has one; anything else has none —
  //     which the chase syncs away with the row.
  //   - OTHER episodes whose chapters quote these words. LEFT ON PURPOSE and
  //     said out loud, the way a spans echo is (§16 G15) — never "unchased",
  //     because nothing failed to be reached.
  const ownJournalFiles = journalFilesFor(store.dir, targetId).length;
  const journalEchoes = journalEcho(store, targetId, body, doc, opts);

  return {
    targetId,
    valid: true,
    reason: "ok",
    contamination,
    surfaces: [
      { surface: "prose", count: 1 },
      { surface: "versions", count: versions.length },
      { surface: "edges", count: edges.length },
      { surface: "prospective", count: prospective.length },
      { surface: "operational rows", count: 1 },
      { surface: "cache", count: 1 },
      // Stated at 0 too, like `spans`: silence about an empty surface is what
      // made the span residue undiscoverable (LAUNCH-STATUS §I2). The count is
      // this memory's OWN copy; the echo below is a different question and gets
      // its own sentence, because a `0` here with an echo under it would read as
      // "this surface is clean" over a file that holds the words.
      { surface: "journal", count: ownJournalFiles },
      // The seventh, and it is in this list rather than beside it now: a surface
      // that is chased belongs with the chased ones. It is stated at 0 too — the
      // silence about an empty buffer is what made the residue undiscoverable
      // (LAUNCH-STATUS §I2). Not for `unknown`, where a `0` beside a "NOT
      // chased" line would read as a contradiction rather than a disclosure;
      // that state says its whole piece in its own sentence.
      ...(spans.state === "unknown" ? [] : [{ surface: "spans", count: spans.count }]),
    ],
    spans,
    spanChase: {
      scope: chase.scope,
      hashes: chase.hashes,
      // A content match is what the strike falls back to when the mint recorded
      // no hash. Only when there IS a body to match on, and only when the scope
      // is recorded — or the owner has said, in so many words, that a chase
      // across every project on the machine is what they want (review F4).
      byContent:
        chase.hashes.length === 0 &&
        body.trim().length > 0 &&
        (chase.scope !== null || opts.crossScopeContent === true),
    },
    // Empty of CHASE failures until run time (the box-2 chase landed 2026-08-25,
    // INTERFACE-GAPS §1; the span chase 2026-09-05) — and no longer holding the
    // `held` case, which is chased. `unknown` stays: a surface this console
    // cannot rule out is exactly what §16 G15's "no silent partial success"
    // says a plan must name here rather than let the report say `nothing`.
    // A surface this console could not rule out. NOT the echo, which is not a
    // failure to reach anything — see `leftAlone` (review F6).
    unchasable: spans.state === "unknown" ? [spans.line] : [],
    // What is deliberately not taken. The wording is the plan's, so the dry run
    // and the completion report say the same thing about the same lines.
    leftAlone: [
      ...(spans.echoes > 0
        ? [
            `spans echo: ${spans.echoes} line${spans.echoes === 1 ? "" : "s"} of conversation quoting these words — transcript, not this memory's capture. Left on purpose. Nothing prunes the buffer today, so ${spans.echoes === 1 ? "it stays" : "they stay"} there.`,
          ]
        : []),
      ...(journalEchoes.ids.length > 0
        ? [
            `journal echo: ${journalEchoes.ids.length} episode${journalEchoes.ids.length === 1 ? "" : "s"} whose chapters quote these words — the counterpart's own account of those days, not this memory. Left on purpose, row and markdown copy alike, so ${journalEchoes.ids.length === 1 ? "that .md under journal/ still holds the words" : "those .md files under journal/ still hold the words"}, and any snapshot or backup already taken holds them too. To take one as well: ${journalEchoes.ids.map((id) => `counterparts remove ${id} --confirm`).join(" · ")}`,
          ]
        : []),
      // A BOUNDED CHECK SAYS SO. A stated bound is survivable; a silent one is
      // the finding this whole line exists to close (MAJOR-3).
      ...(journalEchoes.checked < journalEchoes.total
        ? [
            `journal echo check was BOUNDED: checked ${journalEchoes.checked} of ${journalEchoes.total} episodes, so an episode past that quoting these words is not named above. 'counterparts export --out <dir> --markdown --plaintext' writes every chapter out if you want to look yourself.`,
          ]
        : []),
      // THE COPIES ALREADY ON DISK, whenever a journal file is in play — this
      // memory's own, or another episode's (review f6f7 MAJOR-5).
      ...(row.type === "episode" || journalEchoes.ids.length > 0
        ? [olderCopiesNote(store.dir)]
        : []),
    ],
  };
}

/**
 * STEPS 3–5. The one implementation of `OwnerRemovalPort`.
 *
 * It throws only when the RECORD cannot be written, because that is the single
 * failure where doing nothing is correct. Every later failure is caught, counted
 * and reported in `unchased` — a chase that half-worked must say so.
 */
export function ownerRemoval(
  store: Store,
  request: OwnerRemovalRequest,
  opts: RemovalOptions = {},
): OwnerRemovalOutcome {
  const emit = opts.onEvent ?? ((): void => {});
  const notes: RemovalNote[] = [];
  const append = (stage: RemovalNote["stage"], addendum?: string): void => {
    const note: RemovalNote = {
      memoryId: request.targetId,
      stage,
      actor: request.actor,
      // The OWNER's reason stays first and whole; an addendum is appended
      // rather than substituted, because why he removed it is the part of this
      // record that matters longest.
      reason: addendum === undefined ? request.reason : `${request.reason} [${addendum}]`,
    };
    store.appendRemovalRecord(note);
    notes.push(note);
    emit("cli.removal.stage", { stage, target: request.targetId });
  };

  const plan = planRemoval(store, request.targetId, {
    ...(opts.crossScopeContent === undefined ? {} : { crossScopeContent: opts.crossScopeContent }),
  });
  if (!plan.valid) {
    // Nothing is recorded for a target that was never removable: a record here
    // would put an id on the deny-list on the strength of a typo.
    throw new Error(`removal refused: ${plan.reason}`);
  }

  // 3. REQUESTED — if this throws, nothing has moved and nothing will (§16 G10).
  append("requested");

  // Read the body BEFORE `dark`, and keep it local: it is the strike's fallback
  // predicate for a memory whose mint recorded no span hash, and after the chase
  // there is nothing left to match on. It never enters the plan, the report or
  // any record — the seam receives a FUNCTION, not a string (§16 G15).
  let doomedBody = "";
  try {
    doomedBody = store.readProse(request.targetId).body.trim();
  } catch {
    /* already gone; the hashes are the chase then, or nothing is */
  }

  // 4. DARK — the deny-list is live from this line onward (§16 G12).
  append("dark");

  const chased: string[] = [];
  const unchased: string[] = [...plan.unchasable];
  const leftAlone: string[] = [...plan.leftAlone];

  // 5. CHASE. THE SPAN BUFFER FIRST, because it is the only surface whose key
  //    the later steps destroy: `chaseRemoved` blanks the row — its
  //    `origin_ref`, its body and its `content_hash` — and those are what
  //    address a span. Strike while the addressing still exists.
  //
  //    It is `remember/`'s own seam, not an `rmSync` from here: `spans/` is that
  //    module's state machine, and a claim renaming the buffer aside underneath
  //    a naive rewrite is the "in neither claim nor buffer" state spec §2 G6
  //    exists to forbid (cli/INTERFACE-GAPS §9).
  if (plan.spans.state === "held") {
    try {
      const buffer = new SpanBuffer({ dir: store.dir, day: () => store.livedDay() });
      const report = strikeSpans(buffer, {
        scope: plan.spanChase.scope,
        hashes: plan.spanChase.hashes,
        // EXACT-LINE EQUALITY, never a substring (review F4). A jot whose whole
        // text is this memory's body IS this memory; a jot that merely contains
        // the words is a different memory that mentions them, and striking it
        // is a destruction nobody asked for.
        ...(plan.spanChase.byContent && doomedBody.length > 0
          ? { predicate: (text: string): boolean => text.trim() === doomedBody }
          : {}),
      });
      if (report.reason === "STRUCK") {
        chased.push(`spans(${report.struck} line${report.struck === 1 ? "" : "s"} in ${report.files.length} file${report.files.length === 1 ? "" : "s"})`);
        // What happened to the OTHER two places a span hash lives, said out
        // loud: the terminal ledger keeps the hash so nothing re-admits the
        // words, and a claim file mid-arc was rewritten under its worker.
        if (report.ledgered > 0) {
          chased.push(`spans ledger(${report.ledgered} hash${report.ledgered === 1 ? "" : "es"} kept in consumed.jsonl so nothing re-captures the words)`);
        }
        if (report.touchedClaim) chased.push("spans claim file(rewritten; a restore cannot put it back)");
        emit("cli.removal.spans", {
          struck: report.struck,
          files: report.files.length,
          ledgered: report.ledgered,
          byHash: plan.spanChase.hashes.length > 0,
        });
        if (report.recovered > 0) {
          chased.push(`spans recovered(${report.recovered} line${report.recovered === 1 ? "" : "s"} folded back out of a crashed strike's aside)`);
        }
      } else {
        // The failure arm gets its OWN sentence. Reusing the plan's line here
        // printed "the removal strikes them out of it" underneath a strike that
        // did not happen — the report contradicting itself in the one place it
        // must not (review, note-only).
        unchased.push(
          `spans (${report.reason}) — the strike did not run; ${plan.spans.path ?? "the capture buffer"} still holds this memory's words, and ${SPANS_BLIND}`,
        );
      }
    } catch {
      unchased.push(
        `spans (threw) — the strike did not run; ${plan.spans.path ?? "the capture buffer"} still holds this memory's words, and ${SPANS_BLIND}`,
      );
    }
  }

  //    THE WORDS ARE NOT A SEPARATE STEP ANY MORE. Until the floor this is
  //    where box 1 was chased: unlink the memory's prose file, unlink each
  //    archived version's file, remove the `versions/<id>/` directory — four
  //    filesystem operations with three crash points between them and the box-2
  //    transaction below, each one leaving a different half-erased state. Since
  //    schema v6 the words are columns on the rows, so `chaseRemoved` blanks
  //    them inside the same transaction that removes the edges and appends the
  //    record. One commit; no window (§16 G11).
  //
  // Box 2, and the `chased` stage with it: the seam appends the record INSIDE
  // its own transaction, so the rows and the record land together or not at all.
  // What survives is named in the report, never implied (§16 G15).
  try {
    const report = chaseRemoved(store, request.targetId);
    for (const surface of report.removed) chased.push(`${surface.surface}(${surface.count})`);
    for (const surface of report.neutralized) {
      chased.push(`${surface.surface}(${surface.count}, tombstoned)`);
    }
    notes.push({ memoryId: request.targetId, stage: "chased", actor: request.actor });
    emit("cli.removal.stage", { stage: "chased", target: request.targetId });
  } catch {
    unchased.push("operational rows");
    append("chased");
  }

  // THE JOURNAL'S MARKDOWN COPY (F6), chased after the row and before the
  // cache, because it is derived from the row and the row has just gone dark.
  //
  // It is a file under `<store>/journal/` holding an episode's words, and it is
  // exactly the shape of finding the reviews raised twice on this floor: a
  // second on-disk copy the chase does not visit while the console prints
  // `unchased: nothing`. `syncJournalCopy` re-asks the invariant rather than
  // deleting by name — the row is tombstoned and denied by now, so the answer
  // is "no file", and the same call is what the chapter door uses to write one.
  try {
    const synced = syncJournalCopy(store, request.targetId);
    if (synced.outcome === "failed") {
      unchased.push(
        `journal (${synced.reason ?? "unknown"}) — the markdown copy of this episode is still under ${JOURNAL_STILL_THERE}`,
      );
    } else if (synced.outcome === "removed") {
      chased.push("journal(1 markdown copy)");
    } else {
      // "nothing to remove" is a disclosure, not a silence: a memory that never
      // had a journal file and an episode whose file was chased must not read
      // the same (§16 G15). And when an ECHO was reported, this line may not
      // say "nothing beside the row" — that reads as "this surface is clean"
      // two lines above a disclosure that it is not (review f6f7 MAJOR-3).
      const echoes = plan.leftAlone.filter((line) => line.startsWith("journal echo:")).length;
      chased.push(
        echoes === 0
          ? "journal(0, nothing beside the row)"
          : "journal(0 of its own; other episodes' copies left on purpose, see above)",
      );
    }
  } catch {
    unchased.push(`journal (threw) — the markdown copy may still be under ${JOURNAL_STILL_THERE}`);
  }

  // Box 3: the rebuild skips every denied id and LOGS the skip, so the cache
  // comes back without the memory and with a record that it was left out.
  try {
    store.rebuildCache();
    chased.push("cache");
  } catch {
    unchased.push("cache");
  }

  // THE WRITE-AHEAD LOG IS A SURFACE, and the floor is what made it one.
  //
  // §16 G14 says every copy is chased. While the words were a file, the blank
  // of the row's pointer and the `rmSync` of the file between them left nothing
  // readable behind. Now the words are a COLUMN, and an `UPDATE ... SET
  // body = ''` in WAL mode appends the change to the `-wal` while the page
  // holding the old text stays in it until a checkpoint moves it. Measured
  // 2026-09-20 on this branch: right after a chase the doomed text is NOT in
  // `counterparts.sqlite` and IS in `counterparts.sqlite-wal`; one TRUNCATE
  // checkpoint clears it from both. (Nothing that LEAVES the machine ever held
  // it — `backup` and `export` are `VACUUM INTO`, measured clean either way.)
  //
  // TRUNCATE rather than PASSIVE, because PASSIVE leaves the file at its length
  // with the old bytes still in it. On its own connection, and it never throws:
  // a checkpoint contended by another reader is reported as unchased, which is
  // true and actionable, rather than taking the removal down after the rows
  // have already gone.
  chaseWriteAheadLog(store.dir, chased, unchased);

  // THE DURABLE RECORD MUST NOT CLAIM MORE THAN THE CONSOLE (third review's
  // open question). The record's stages carry no surface list, so `complete`
  // has always meant "the ceremony finished", not "everything was reached" —
  // but a reader coming back to it months later has only that word. So when
  // anything went unchased the count rides on the stage's own `reason`, beside
  // the owner's: the console's sentence is ephemeral and this is not.
  append(
    "complete",
    unchased.length === 0
      ? undefined
      : `${unchased.length} surface${unchased.length === 1 ? "" : "s"} unchased — see the console report`,
  );
  emit("cli.removal.complete", {
    target: request.targetId,
    chased: chased.length,
    unchased: unchased.length,
    contamination: plan.contamination.length,
  });

  return { chased, unchased, leftAlone, notes };
}

/**
 * Fold the write-ahead log back into the database and truncate it, so the page
 * that held the removed words stops being readable beside the store.
 *
 * Never throws (CLI CONTRACT §5 G8's reasoning): by the time this runs the rows
 * are already gone and the record is already written, and a failure here is a
 * line in the report, not an exception out of a removal that succeeded.
 */
function chaseWriteAheadLog(dir: string, chased: string[], unchased: string[]): void {
  // BOTH DATABASES, and the second one is review B's MAJOR-1.
  //
  // The first draft checkpointed box 2 and called the surface done. Box 3 is
  // also in WAL and also holds the removed memory's text — as `doc_tokens`
  // rows, rewritten by the `rebuildCache()` one step earlier — and the OLD
  // pages sit in `cache/cache.sqlite` until something folds them over.
  // Reviewer B found the words there in 3 of 5 runs of one shape while the
  // console printed `unchased: nothing`: the owner told the directory was
  // clean when it was not. The index really was chased (`live_rows=[]`); it was
  // the bytes on disk that were not, and the same open-checkpoint-close cleared
  // them 3/3 when asked directly.
  //
  // Not a freelist problem and not a `secure_delete` one (`freelist_count` was
  // 0 in those runs): these are exactly box 2's pages, in the database this
  // function did not visit. Reported as its OWN surface, so "cache" keeps
  // meaning the index and this keeps meaning the file.
  reclaim(paths.operational(dir), "write-ahead log and freed pages", chased, unchased);
  reclaim(paths.cache(dir), "cache write-ahead log and freed pages", chased, unchased);
}

/**
 * One database made to stop holding the removed words: **VACUUM, then a TRUNCATE
 * checkpoint**, reported by name.
 *
 * **Why VACUUM and not just the checkpoint** (the third review's NEW-MAJOR-1).
 * Blanking a body frees the pages it sat on, and a body long enough to take
 * OVERFLOW pages leaves whole pages on the freelist. `secure_delete` is 2 (FAST)
 * by default, which zeroes only the slack of a page being rewritten, never a
 * whole freed page — so the words stayed legible in `counterparts.sqlite`
 * itself, in a page no row points at, while the report said `unchased: nothing`.
 * Measured on this branch, deterministic 5/5 with marks at the start, middle and
 * end of a ~40 KB body: only the START mark was cleared (its page gets reused),
 * the middle and the end survived. A SECOND checkpoint does not help. VACUUM
 * rebuilds the file from the live pages only, and it is the one remedy that
 * clears residue whatever freed the page and whenever — a revision months ago,
 * a prune, this removal — which is what "removed means gone" has to mean.
 *
 * **Order matters:** in WAL mode a VACUUM writes into the log, so the main file
 * is unchanged until a checkpoint. VACUUM alone reads as a no-op.
 *
 * `secure_delete = ON` for the chase's own connection was the cheaper candidate
 * and is NOT used: it measured clean on some shapes and left the middle and end
 * marks on others, because it only zeroes what THAT transaction frees — a page
 * freed by an earlier revision is not its business. A guarantee that depends on
 * page-allocation luck is not a guarantee.
 *
 * **Cost, measured, on a 17,000-memory store** (9.3 MB box 2, 16.6 MB box 3):
 * VACUUM 23 ms and 58 ms, checkpoint under a millisecond. Removal is a rare,
 * deliberate owner operation; this is not a price anyone will feel.
 *
 * It never throws (CLI CONTRACT §5 G8): by the time this runs the rows are gone
 * and the record is written. A contended VACUUM is a line in the report saying
 * what is still there and what clears it — never silence, and never `nothing`.
 */
function reclaim(path: string, surface: string, chased: string[], unchased: string[]): void {
  // A database that is not there has nothing to reclaim. Box 3 is rebuildable
  // and a store may never have built one.
  if (!existsSync(path)) return;
  let db;
  try {
    db = openDb(path);
    db.exec("VACUUM");
    const row = db.get<Record<string, number>>("PRAGMA wal_checkpoint(TRUNCATE)");
    // The first column is 1 when SQLite could not finish — a reader was holding
    // an older snapshot. Say so; the next checkpoint clears it.
    const busy = row === undefined ? 1 : Object.values(row)[0];
    if (busy === 0) chased.push(surface);
    else unchased.push(`${surface} (${STILL_THERE})`);
  } catch (err) {
    // The REASON rides along — a SQLite message is a code and a path, never
    // memory text (§5 G10) — because "could not" with no why is the silence
    // this whole report exists to remove.
    const why = isLocked(err) ? "the database was busy" : String((err as Error).message ?? err);
    unchased.push(`${surface} (${why}; ${STILL_THERE})`);
  } finally {
    try {
      db?.close();
    } catch {
      /* a handle that will not close has already said what it could */
    }
  }
}

/**
 * What is true when the reclaim could not finish, and what clears it. Said in
 * the report rather than left as a silence: the ROWS are gone either way — this
 * is about pages no row points at, which a later removal or a named command
 * folds over.
 */
const STILL_THERE =
  "the memory's rows are gone, but its words may remain in pages no row points at until " +
  "the next successful removal or 'counterparts verify --dir <store> --rebuild'";

/**
 * The read-back a removal is only trustworthy with: is the id dark, is its prose
 * gone, and does any canonical file still hold its text? Ids only in, verdict
 * out — no body ever crosses this boundary.
 */
export function verifyRemoval(store: Store, targetId: string): {
  denied: boolean;
  /** True when the row carries no words: the body is blank. Named `proseGone`
   *  while the words were a file; it asks the same question of the column. */
  bodyGone: boolean;
  /** True while a row exists at all — after the chase it is a stripped skeleton. */
  rowSurvives: boolean;
  /** True when that row has been stripped of every content pointer. */
  rowTombstoned: boolean;
  /** Box-2 state that should be gone: edges, prospective windows, gate rows. */
  darkState: number;
} {
  const row = store.row(targetId);
  const tombstone = store.tombstones().find((e) => e.id === targetId);
  return {
    denied: store.deniedIds().includes(targetId),
    bodyGone: row === undefined || row.body === "",
    rowSurvives: row !== undefined,
    rowTombstoned: tombstone !== undefined && row !== undefined && rowTombstoned(row),
    darkState:
      store.edgesFrom(targetId).length + store.prospectiveFor(targetId).length,
  };
}
