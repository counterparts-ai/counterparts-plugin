export const FOOTNOTE_HEADER_STEP_0 = "Quietly available (ignorable):";
export const FOOTNOTE_HEADER_STEP_1 = "Quietly available (ignorable; expand an id with recall before citing one):";
export const FRAMING = {
  affect: "Something here carries weight.",
  surfacedHeader: "Came to mind:",
  footnoteHeader: FOOTNOTE_HEADER_STEP_1,
  journal: "Journal:",
  linked: "Linked:"
};
export const TRIM_ORDER = ["footnote", "surfaced", "affect"];
const encoder = new TextEncoder;
export function byteLength(s) {
  return encoder.encode(s).length;
}
export function clip(text, maxBytes) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (byteLength(flat) <= maxBytes)
    return flat;
  const ell = "...";
  const room = Math.max(0, maxBytes - byteLength(ell));
  let out = "";
  for (const ch of flat) {
    if (byteLength(out + ch) > room)
      break;
    out += ch;
  }
  return `${out.trimEnd()}${ell}`;
}
function label(r) {
  return `${r.linked === true ? `${FRAMING.linked} ` : ""}${r.journal === true ? `${FRAMING.journal} ` : ""}${r.standing?.prefix ?? ""}`;
}
function after(r) {
  return r.standing?.suffix ?? "";
}
function openMarker(turn) {
  return `<!-- counterparts:recall t=${turn} -->`;
}
function sentinelLine(surfaced, footnotes, affect, bytes) {
  return `<!-- counterparts:recall/end surfaced=${surfaced} footnotes=${footnotes} affect=${affect ? 1 : 0} bytes=${bytes} -->`;
}
function compose(input, resolve, surfaced, footnotes, affect) {
  const lines = [openMarker(input.turn)];
  if (affect)
    lines.push(FRAMING.affect);
  if (surfaced.length > 0) {
    lines.push("", FRAMING.surfacedHeader);
    for (const id of surfaced) {
      const r = resolve(id);
      lines.push(`- ${label(r)}${clip(r.gist, input.gistBytes)}${after(r)}`);
    }
  }
  if (footnotes.length > 0) {
    lines.push("", FRAMING.footnoteHeader);
    for (const id of footnotes) {
      const r = resolve(id);
      lines.push(`- ${label(r)}${clip(r.title, input.titleBytes)} [${id}]${after(r)}`);
    }
  }
  const body = lines.join(`
`);
  let total = byteLength(body) + 1;
  let sentinel = sentinelLine(surfaced.length, footnotes.length, affect, total);
  for (let i = 0;i < 5; i++) {
    const next = byteLength(body) + 1 + byteLength(sentinel);
    if (next === total)
      break;
    total = next;
    sentinel = sentinelLine(surfaced.length, footnotes.length, affect, total);
  }
  const text = `${body}
${sentinel}`;
  return { text, bytes: byteLength(text), sentinel };
}
export function render(input, resolve) {
  const surfaced = [...input.surfaced];
  const footnotes = [...input.footnotes];
  let affect = input.affectFlag;
  const trimmed = [];
  if (surfaced.length === 0 && footnotes.length === 0 && !affect) {
    return {
      text: "",
      bytes: 0,
      budgetBytes: input.budgetBytes,
      surfaced: [],
      footnotes: [],
      affectFlag: false,
      trimmed,
      sentinel: null,
      pressure: false
    };
  }
  for (;; ) {
    const c = compose(input, resolve, surfaced, footnotes, affect);
    if (c.bytes <= input.budgetBytes) {
      return {
        text: c.text,
        bytes: c.bytes,
        budgetBytes: input.budgetBytes,
        surfaced,
        footnotes,
        affectFlag: affect,
        trimmed,
        sentinel: c.sentinel,
        pressure: c.bytes >= input.budgetBytes * input.pressureRatio
      };
    }
    let cut = false;
    for (const lane of TRIM_ORDER) {
      if (lane === "footnote" && footnotes.length > 0) {
        trimmed.push({ lane, id: footnotes.pop() ?? null });
        cut = true;
        break;
      }
      if (lane === "surfaced" && surfaced.length > 0) {
        trimmed.push({ lane, id: surfaced.pop() ?? null });
        cut = true;
        break;
      }
      if (lane === "affect" && affect) {
        trimmed.push({ lane, id: null });
        affect = false;
        cut = true;
        break;
      }
    }
    if (!cut) {
      return {
        text: "",
        bytes: 0,
        budgetBytes: input.budgetBytes,
        surfaced: [],
        footnotes: [],
        affectFlag: false,
        trimmed,
        sentinel: null,
        pressure: true
      };
    }
  }
}
