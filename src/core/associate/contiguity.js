export function planContiguity(rows, t) {
  const deltas = [];
  let timed = 0;
  let batch = 0;
  let underFloor = 0;
  const flat = (1 + t.CONTIGUITY_BACKWARD) / 2;
  for (let i = 0;i < rows.length; i++) {
    const earlier = rows[i];
    for (let lag = 1;lag <= t.CONTIGUITY_WINDOW; lag++) {
      const later = rows[i + lag];
      if (later === undefined)
        break;
      if (!earlier.fresh && !later.fresh)
        continue;
      if (earlier.id === later.id)
        continue;
      const base = t.CONTIGUITY_RATE * Math.pow(t.CONTIGUITY_LAG_DECAY, lag - 1);
      const real = later.at - earlier.at > t.CONTIGUITY_BATCH_MS;
      const forward = real ? base : base * flat;
      const back = real ? base * t.CONTIGUITY_BACKWARD : base * flat;
      if (!(forward > 0) && !(back > 0))
        continue;
      if (real)
        timed += 1;
      else
        batch += 1;
      if (forward <= t.EDGE_FLOOR)
        underFloor += 1;
      if (back <= t.EDGE_FLOOR)
        underFloor += 1;
      deltas.push(forward === back ? { a: earlier.id, b: later.id, delta: forward } : { a: earlier.id, b: later.id, delta: forward, back });
    }
  }
  return { deltas, pairs: deltas.length, timed, batch, underFloor };
}
