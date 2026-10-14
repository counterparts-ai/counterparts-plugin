const CSI = `${String.fromCharCode(27)}[`;
const RESET = `${CSI}0m`;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function wrap(code, s) {
  return s.length === 0 ? s : `${CSI}${code}m${s}${RESET}`;
}
const IDENTITY = (s) => s;
export const PLAIN = {
  enabled: false,
  bold: IDENTITY,
  dim: IDENTITY,
  underline: IDENTITY,
  warn: IDENTITY,
  ok: IDENTITY
};
const COLOUR = {
  enabled: true,
  bold: (s) => wrap("1", s),
  dim: (s) => wrap("2", s),
  underline: (s) => wrap("4", s),
  warn: (s) => wrap("33", s),
  ok: (s) => wrap("32", s)
};
export function style(enabled) {
  return enabled ? COLOUR : PLAIN;
}
export function terminalWantsColour(env = process.env) {
  const noColour = env["NO_COLOR"];
  if (typeof noColour === "string" && noColour.length > 0)
    return false;
  return process.stdout.isTTY === true;
}
export function visibleWidth(s) {
  return stripAnsi(s).length;
}
export function stripAnsi(s) {
  return s.replace(ANSI_PATTERN, "");
}
