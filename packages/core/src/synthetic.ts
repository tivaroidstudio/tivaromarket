/** Deterministic synthetic candles for tests and the offline demo. Clearly NOT market data. */
import { TIMEFRAME_MS, type Candle, type Timeframe } from './types.ts';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticCandles(opts: {
  n: number;
  timeframe: Timeframe;
  start: number;
  price?: number;
  drift?: number;
  vol?: number;
  seed?: number;
}): Candle[] {
  const rnd = mulberry32(opts.seed ?? 42);
  const step = TIMEFRAME_MS[opts.timeframe];
  const vol = opts.vol ?? 0.01;
  let p = opts.price ?? 100;
  const out: Candle[] = [];
  for (let i = 0; i < opts.n; i++) {
    const g = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const o = p;
    const c = Math.max(0.0001, o * (1 + (opts.drift ?? 0) + vol * g));
    const h = Math.max(o, c) * (1 + vol * 0.5 * rnd());
    const l = Math.min(o, c) * (1 - vol * 0.5 * rnd());
    out.push({ t: opts.start + i * step, o, h, l, c, v: 1000 + 1000 * rnd() });
    p = c;
  }
  return out;
}
