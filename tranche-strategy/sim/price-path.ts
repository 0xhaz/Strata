/**
 * Synthetic SOL/USDC price path — GBM + occasional jumps, mirroring the process in
 * sim/rebalance_sim.py (~80% ann vol, drift-neutral, ~1 jump/day). Deterministic via
 * a seeded PRNG so the demo replays identically every run (and so this file needs no
 * Math.random — important for reproducibility).
 */
export interface PathPoint {
  ts: number;
  price: number;
}

/** Mulberry32 — tiny deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller standard normal from a uniform PRNG. */
function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface PathOpts {
  p0?: number;
  annVol?: number;
  annDrift?: number;
  jumpProb?: number;
  jumpScale?: number;
  steps?: number;
  stepMinutes?: number;
  startTs?: number;
  seed?: number;
}

export function makePricePath(opts: PathOpts = {}): PathPoint[] {
  const {
    p0 = 150,
    annVol = 0.8,
    annDrift = 0,
    jumpProb = 0.0008,
    jumpScale = 0.04,
    steps = 30 * 24 * 60, // 30 days at 1-min resolution
    stepMinutes = 1,
    startTs = 1_700_000_000_000,
    seed = 7,
  } = opts;
  const rng = mulberry32(seed);
  const dt = stepMinutes / (365 * 24 * 60); // year fraction per step
  const out: PathPoint[] = [];
  let logp = 0;
  for (let i = 0; i < steps; i++) {
    const ret = (annDrift - 0.5 * annVol ** 2) * dt + annVol * Math.sqrt(dt) * randn(rng);
    const jump = rng() < jumpProb ? jumpScale * randn(rng) : 0;
    logp += ret + jump;
    out.push({ ts: startTs + i * stepMinutes * 60_000, price: p0 * Math.exp(logp) });
  }
  return out;
}

/** Downsample a path to ~N points (the agent wakes on a cron interval, not every minute). */
export function sampleEvery<T>(arr: T[], every: number): T[] {
  return arr.filter((_, i) => i % every === 0);
}
