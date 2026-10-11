/* A small text diff, no dependencies: lines first (longest common subsequence),
   then words inside a line that was changed rather than added or removed.
   Pure functions — the self tab renders what they return, and a test runs them. */

/** The longest-common-subsequence edit script between two token arrays.
 *  Returns [{ op: "=" | "-" | "+", v }], in reading order. */
export function diffTokens(a, b) {
  const n = a.length, m = b.length;
  // Too big to do properly in the browser: say everything changed, which is
  // true in the only sense that matters (a page is at most a few hundred lines).
  if (n * m > 4_000_000) {
    return [...a.map((v) => ({ op: "-", v })), ...b.map((v) => ({ op: "+", v }))];
  }
  const w = m + 1;
  const len = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * w + j] = a[i] === b[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: "=", v: a[i] }); i++; j++; }
    else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) { out.push({ op: "-", v: a[i] }); i++; }
    else { out.push({ op: "+", v: b[j] }); j++; }
  }
  while (i < n) out.push({ op: "-", v: a[i++] });
  while (j < m) out.push({ op: "+", v: b[j++] });
  return out;
}

/** Words and the spaces between them, so a rejoin is lossless. */
export function words(line) {
  return line.split(/(\s+)/).filter((t) => t.length > 0);
}

/**
 * Line diff of two texts, with a word diff on each changed line.
 *
 * Returns rows: { op: "=", text } for an unchanged line, { op: "-", parts } and
 * { op: "+", parts } for a removed or added line, where `parts` is
 * [{ op: "=" | "-" | "+", v }] — "-"/"+" marking the words that differ. A run
 * of removals followed by a run of additions is paired line by line, so an
 * edited sentence shows as the words that changed, not as a whole line out and
 * a whole line in.
 */
export function diffText(before, after) {
  const a = (before || "").replace(/\r\n/g, "\n").split("\n");
  const b = (after || "").replace(/\r\n/g, "\n").split("\n");
  const lines = diffTokens(a, b);
  const rows = [];
  let k = 0;
  while (k < lines.length) {
    if (lines[k].op === "=") { rows.push({ op: "=", text: lines[k].v }); k++; continue; }
    const del = [], add = [];
    while (k < lines.length && lines[k].op === "-") del.push(lines[k++].v);
    while (k < lines.length && lines[k].op === "+") add.push(lines[k++].v);
    const pairs = Math.min(del.length, add.length);
    for (let p = 0; p < pairs; p++) {
      const ops = diffTokens(words(del[p]), words(add[p]));
      rows.push({ op: "-", parts: ops.filter((o) => o.op !== "+") });
      rows.push({ op: "+", parts: ops.filter((o) => o.op !== "-") });
    }
    for (let p = pairs; p < del.length; p++) rows.push({ op: "-", parts: [{ op: "-", v: del[p] }] });
    for (let p = pairs; p < add.length; p++) rows.push({ op: "+", parts: [{ op: "+", v: add[p] }] });
  }
  return rows;
}

/** How much changed, in lines — for the one-line summary above a diff. */
export function diffStats(rows) {
  let added = 0, removed = 0;
  for (const r of rows) {
    if (r.op === "+") added++;
    else if (r.op === "-") removed++;
  }
  return { added, removed };
}
