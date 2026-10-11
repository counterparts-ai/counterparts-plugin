/**
 * Running the TypeScript sources under Node — no build step, no dependency.
 *
 * Bun runs `.ts` directly. Node (22.15+, 23.5+, 24) gets there with this file,
 * loaded first: `node --import <this file> <script.ts>`. It registers two
 * synchronous module hooks (`module.registerHooks`):
 *
 *   - **resolve**: the sources import each other as `./x.js` (the NodeNext
 *     convention tsc wants), and the file on disk is `./x.ts`. A relative `.js`
 *     specifier from a `.ts` parent that has no `.js` file but has a `.ts` one
 *     resolves to the `.ts`.
 *   - **load**: a `.ts` file is read and handed to Node's own
 *     `stripTypeScriptTypes` in strip mode (types become whitespace, so line and
 *     column numbers in a stack trace are the source's). Doing it here rather
 *     than through `--experimental-strip-types` is what lets an npm install run:
 *     Node's built-in stripping refuses any file under `node_modules`
 *     (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), and that is where an
 *     installed package lives.
 *
 * Strip mode cannot rewrite TypeScript that has runtime meaning (enums,
 * parameter properties, namespaces); `tsconfig.json`'s `erasableSyntaxOnly`
 * keeps the sources inside what it can do, and `verbatimModuleSyntax` keeps a
 * type-only import from surviving as a runtime import.
 *
 * It also quiets the two ExperimentalWarnings this path raises on every start
 * (`node:sqlite`, type stripping): a hook's stderr reaches the user's terminal,
 * and a warning on every turn about a choice the package made is noise. Every
 * other warning passes through untouched.
 *
 * Under Bun this file does nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";

const QUIET = /SQLite is an experimental feature|stripTypeScriptTypes|Type Stripping is an experimental/;

function isQuieted(warning, rest) {
  const option = rest[0];
  const type =
    typeof option === "string" ? option : (option?.type ?? (warning instanceof Error ? warning.name : undefined));
  const message = warning instanceof Error ? warning.message : String(warning);
  return type === "ExperimentalWarning" && QUIET.test(message);
}

if (process.versions.bun === undefined) {
  const { registerHooks, stripTypeScriptTypes } = nodeModule;
  if (typeof registerHooks !== "function" || typeof stripTypeScriptTypes !== "function") {
    process.stderr.write(
      `counterparts: Node ${process.versions.node} cannot run it; it needs Node 22.15 or later (or Bun).\n`,
    );
    process.exit(1);
  }

  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    if (isQuieted(warning, rest)) return;
    return emitWarning.call(process, warning, ...rest);
  };

  // THE FLOOR, CHECKED FOR REAL: the store needs `node:sqlite`, and a Node that
  // cannot hand it over (too old, or started with `--no-experimental-sqlite`)
  // would otherwise reach every hook as "memory is OFF". One line, before
  // anything runs. `getBuiltinModule` is how `core/store/db.ts` loads it too.
  let sqlite;
  try {
    sqlite = process.getBuiltinModule?.("node:sqlite");
  } catch {
    sqlite = undefined;
  }
  if (typeof sqlite?.DatabaseSync !== "function") {
    process.stderr.write(
      `counterparts: Node ${process.versions.node} can't load node:sqlite; use Node 22.15 or later (without --no-experimental-sqlite), or Bun.\n`,
    );
    process.exit(1);
  }

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL;
      if (
        parent !== undefined &&
        parent.startsWith("file:") &&
        parent.endsWith(".ts") &&
        specifier.endsWith(".js") &&
        (specifier.startsWith("./") || specifier.startsWith("../"))
      ) {
        const js = new URL(specifier, parent);
        const ts = new URL(specifier.slice(0, -3) + ".ts", parent);
        if (!existsSync(fileURLToPath(js)) && existsSync(fileURLToPath(ts))) {
          return { url: ts.href, format: "module", shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith("file:") && url.endsWith(".ts")) {
        const source = readFileSync(fileURLToPath(url), "utf8");
        return {
          format: "module",
          source: stripTypeScriptTypes(source, { mode: "strip" }),
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
}
