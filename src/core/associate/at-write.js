export function planAtWrite(memories, t) {
  const fresh = new Set(memories.map((m) => m.id));
  const seen = new Set;
  const pairs = [];
  let linked = 0;
  for (const m of memories) {
    let n = 0;
    for (const other of m.inMind) {
      if (n >= t.WRITE_LINK_MAX)
        break;
      if (other === m.id || fresh.has(other))
        continue;
      const key = m.id < other ? `${m.id}|${other}` : `${other}|${m.id}`;
      if (seen.has(key))
        continue;
      seen.add(key);
      pairs.push({ a: m.id, b: other });
      n += 1;
    }
    if (n > 0)
      linked += 1;
  }
  return { pairs, memories: linked };
}
