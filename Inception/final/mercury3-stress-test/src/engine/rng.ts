// Deterministic seeded PRNG (mulberry32) for reproducible demo data.
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: number): Rng {
  return mulberry32(seed);
}

export class SeededRandom {
  private rng: Rng;
  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }
  next(): number {
    return this.rng();
  }
  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + (max - min) * this.rng();
  }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick from empty array');
    return arr[Math.floor(this.rng() * arr.length)];
  }
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    const total = entries.reduce((s, e) => s + e[1], 0);
    let r = this.rng() * total;
    for (const [value, w] of entries) {
      r -= w;
      if (r <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }
  chance(p: number): boolean {
    return this.rng() < p;
  }
}
