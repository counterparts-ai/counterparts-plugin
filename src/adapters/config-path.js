import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  DEFAULT_DATA_DIR_NAME,
  REQUIRE_EXPLICIT_DIR_ENV,
  explicitDirMalformedRefusal,
  explicitDirSetting
} from "../core/store/index.js";
export const CONFIG_FLAG = "--config";
export const CONFIG_ENV = "COUNTERPARTS_CONFIG";
export const CONFIG_FILE_NAME = "claude-code.json";
export const CONFIG_FILE_EVENT = "adapter.config.file";
export function defaultConfigPath(home = homedir()) {
  return join(home, DEFAULT_DATA_DIR_NAME, CONFIG_FILE_NAME);
}
export function configFlag(argv) {
  for (let i = 0;i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === CONFIG_FLAG) {
      const next = argv[i + 1];
      return next === undefined || next.startsWith("--") ? "" : next;
    }
    if (token.startsWith(`${CONFIG_FLAG}=`))
      return token.slice(CONFIG_FLAG.length + 1);
  }
  return;
}
export function configRefusal(value, source) {
  const named = source === CONFIG_FLAG ? `${CONFIG_FLAG} <path>` : CONFIG_ENV;
  if (value.length === 0) {
    return `refused: ${named} was given nothing. It takes an ABSOLUTE path to a configuration file.`;
  }
  if (!isAbsolute(value)) {
    return `refused: ${named} takes an ABSOLUTE path, and '${value}' is relative. ` + "The processes that read this file are launched by a host from a working directory " + "nobody chose, so a relative path names a different file in every one of them.";
  }
  return null;
}
export function resolveConfigPath(argv = [], env = {}, home = homedir()) {
  const flag = configFlag(argv);
  if (flag !== undefined) {
    const refusal = configRefusal(flag, CONFIG_FLAG);
    return { path: flag, source: CONFIG_FLAG, refusal };
  }
  const fromEnv = env[CONFIG_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    const value = fromEnv.trim();
    return { path: value, source: CONFIG_ENV, refusal: configRefusal(value, CONFIG_ENV) };
  }
  return { path: defaultConfigPath(home), source: "default", refusal: null };
}
export function isNamed(choice, home = homedir()) {
  return choice.source !== "default" && resolve(choice.path) !== defaultConfigPath(home);
}
export function namedUnreadableRefusal(choice, reason, home) {
  if (!isNamed(choice, home) || reason !== "unreadable")
    return null;
  const named = choice.source === CONFIG_FLAG ? `${CONFIG_FLAG} <path>` : CONFIG_ENV;
  return `refused: ${named} names ${choice.path}, which could not be understood — a key in it ` + "does not hold the type this expects. An unreadable configuration resolves to observer " + "and the store falls back to the default one, which is not what you named.";
}
export function namedConfigRefusal(choice, read = (path) => readFileSync(path, "utf8"), home) {
  if (choice.refusal !== null)
    return choice.refusal;
  if (!isNamed(choice, home))
    return null;
  const named = choice.source === CONFIG_FLAG ? `${CONFIG_FLAG} <path>` : CONFIG_ENV;
  let text;
  try {
    text = read(choice.path);
  } catch (err) {
    const code = err !== null && typeof err === "object" && typeof err.code === "string" ? err.code : "UNREADABLE";
    return `refused: ${named} names ${choice.path}, which could not be read (${code}). ` + "A configuration you named is not one this can guess at: the default would be a " + "different store, and using it silently is how a scratch run writes into a live one.";
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `refused: ${named} names ${choice.path}, which is not a JSON object. ` + "An unreadable configuration resolves to observer, and an observer that was " + "POINTED at a file is a stand-down nobody asked for — so this says so instead.";
  }
  return null;
}
export function implicitConfigRefusal(choice, env = process.env) {
  if (choice.source !== "default")
    return null;
  const setting = explicitDirSetting(env);
  if (!setting.armed) {
    return setting.malformed === null ? null : explicitDirMalformedRefusal(setting.malformed);
  }
  return `refused: ${REQUIRE_EXPLICIT_DIR_ENV}=${setting.value} and no configuration was named, so this ` + `would have read the default one, ${choice.path} — which on a machine with an install names the ` + `live store and its credentials. Name one: ${CONFIG_FLAG} <absolute path>, or ${CONFIG_ENV}.`;
}
export function configLine(choice) {
  return choice.source === "default" ? `${choice.path} (the default)` : `${choice.path} (named by ${choice.source})`;
}
