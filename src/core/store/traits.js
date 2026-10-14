import { StoreError } from "./errors.js";
export const TRAIT_AXES = [
  { id: "careful-bold", poles: ["careful", "bold"], gloss: "" },
  { id: "agreeable-candid", poles: ["agreeable", "candid"], gloss: "" },
  { id: "guarded-open", poles: ["guarded", "open"], gloss: "about my inner life" },
  { id: "focused-curious", poles: ["focused", "curious"], gloss: "" },
  { id: "following-initiating", poles: ["following", "initiating"], gloss: "" },
  { id: "inward-outward", poles: ["inward", "outward"], gloss: "my own memory vs others'" },
  { id: "serious-playful", poles: ["serious", "playful"], gloss: "" }
];
export const TRAIT_AXIS_IDS = TRAIT_AXES.map((a) => a.id);
export function axisOfPole(pole) {
  return TRAIT_AXES.find((a) => a.poles.includes(pole))?.id;
}
export function polesOf(axis) {
  const a = TRAIT_AXES.find((x) => x.id === axis);
  return a === undefined ? undefined : a.poles;
}
export const TRAIT_SOURCES = ["session", "reflection"];
export const TRAIT_CARRIED_BY_MAX_CHARS = 1000;
function invalid(index, reason, extra = {}) {
  throw new StoreError("TRAIT_INVALID", { index, reason, ...extra });
}
export function checkTraits(inputs) {
  return checkTraitsRepaired(inputs).rows;
}
export function checkTraitsRepaired(inputs) {
  const out = [];
  const repairs = [];
  inputs.forEach((t, i) => {
    if (t === null || typeof t !== "object")
      invalid(i, "not-an-object");
    if (typeof t.axis !== "string" || polesOf(t.axis) === undefined) {
      const said = typeof t.axis === "string" ? t.axis : "";
      const asPole = axisOfPole(said);
      invalid(i, asPole === undefined ? "axis-unknown" : "axis-is-a-pole", {
        allowed: TRAIT_AXIS_IDS.join("|"),
        ...asPole === undefined ? {} : { axisOfPole: asPole }
      });
    }
    const poles = polesOf(t.axis);
    if (typeof t.toward !== "string" || !poles.includes(t.toward)) {
      const other = typeof t.toward === "string" ? axisOfPole(t.toward) : undefined;
      invalid(i, other === undefined ? "toward-unknown" : "toward-on-another-axis", {
        allowed: poles.join("|"),
        ...other === undefined ? {} : { axisOfPole: other }
      });
    }
    if (typeof t.strength !== "number" || !Number.isFinite(t.strength) || t.strength < 0 || t.strength > 1) {
      invalid(i, "strength-out-of-range");
    }
    const sent = t.carriedBy ?? "";
    if (typeof sent !== "string")
      invalid(i, "carried-by-not-a-string");
    let carriedBy = sent;
    if (sent.length > TRAIT_CARRIED_BY_MAX_CHARS) {
      carriedBy = `${sent.slice(0, TRAIT_CARRIED_BY_MAX_CHARS - 1)}…`;
      repairs.push({ index: i, field: "carried_by", note: `carried_by was kept to its first ${String(TRAIT_CARRIED_BY_MAX_CHARS)} characters.` });
    }
    out.push({ axis: t.axis, toward: t.toward, strength: t.strength, carriedBy });
  });
  return { rows: out, repairs };
}
