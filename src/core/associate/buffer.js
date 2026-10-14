import { pairKey } from "./edges.js";

export class DeltaBuffer {
  pairs = new Map;
  add(a, b, delta, back = delta) {
    if (delta <= 0 && back <= 0 || a === b)
      return;
    const key = pairKey(a, b);
    const [lo, hi, ab, ba] = a < b ? [a, b, delta, back] : [b, a, back, delta];
    const have = this.pairs.get(key);
    const nextAb = (have?.delta ?? 0) + ab;
    const nextBa = (have === undefined ? 0 : have.back ?? have.delta) + ba;
    this.pairs.set(key, nextAb === nextBa ? { a: lo, b: hi, delta: nextAb } : { a: lo, b: hi, delta: nextAb, back: nextBa });
  }
  get size() {
    return this.pairs.size;
  }
  pending() {
    return [...this.pairs.values()].map((p) => ({ ...p }));
  }
  drain() {
    const taken = this.pairs;
    this.pairs = new Map;
    return [...taken.values()];
  }
}
