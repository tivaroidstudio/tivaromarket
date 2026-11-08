/**
 * Technical indicators. Every function returns an array aligned with the input
 * (same length); values that cannot be computed yet are `NaN`.
 */
import type { Candle } from './types.ts';

const nanArray = (n: number): number[] => new Array<number>(n).fill(Number.NaN);
export const closes = (c: Candle[]) => c.map((x) => x.c);

export function sma(values: number[], period: number): number[] {
  const out = nanArray(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values (TradingView-style). NaNs at the start are skipped. */
export function ema(values: number[], period: number): number[] {
  const out = nanArray(values.length);
  const k = 2 / (period + 1);
  let start = values.findIndex((v) => !Number.isNaN(v));
  if (start < 0 || values.length - start < period) return out;
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += values[i];
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (RMA), used by RSI / ATR / ADX. */
export function rma(values: number[], period: number): number[] {
  const out = nanArray(values.length);
  let start = values.findIndex((v) => !Number.isNaN(v));
  if (start < 0 || values.length - start < period) return out;
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += values[i];
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function wma(values: number[], period: number): number[] {
  const out = nanArray(values.length);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += values[i - j] * (period - j);
    out[i] = s / denom;
  }
  return out;
}

export function stdev(values: number[], period: number): number[] {
  const out = nanArray(values.length);
  for (let i = period - 1; i < values.length; i++) {
    let m = 0;
    for (let j = i - period + 1; j <= i; j++) m += values[j];
    m /= period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - m) ** 2;
    out[i] = Math.sqrt(v / period);
  }
  return out;
}

export function rsi(values: number[], period = 14): number[] {
  const gains = nanArray(values.length);
  const losses = nanArray(values.length);
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gains[i] = Math.max(d, 0);
    losses[i] = Math.max(-d, 0);
  }
  const ag = rma(gains, period);
  const al = rma(losses, period);
  return values.map((_, i) => {
    if (Number.isNaN(ag[i])) return Number.NaN;
    if (al[i] === 0) return ag[i] === 0 ? 50 : 100;
    return 100 - 100 / (1 + ag[i] / al[i]);
  });
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => f[i] - s[i]);
  const sig = ema(line, signal);
  const hist = line.map((v, i) => v - sig[i]);
  return { macd: line, signal: sig, histogram: hist };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const sd = stdev(values, period);
  const upper = mid.map((m, i) => m + mult * sd[i]);
  const lower = mid.map((m, i) => m - mult * sd[i]);
  const percentB = values.map((v, i) => (v - lower[i]) / (upper[i] - lower[i]));
  const bandwidth = mid.map((m, i) => (upper[i] - lower[i]) / m);
  return { middle: mid, upper, lower, percentB, bandwidth };
}

export function trueRange(c: Candle[]): number[] {
  return c.map((x, i) =>
    i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c)),
  );
}

export function atr(c: Candle[], period = 14): number[] {
  return rma(trueRange(c), period);
}

export function stochastic(c: Candle[], kPeriod = 14, dPeriod = 3, smooth = 3) {
  const raw = nanArray(c.length);
  for (let i = kPeriod - 1; i < c.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, c[j].h);
      ll = Math.min(ll, c[j].l);
    }
    raw[i] = hh === ll ? 50 : ((c[i].c - ll) / (hh - ll)) * 100;
  }
  const k = smaSkipNaN(raw, smooth);
  const d = smaSkipNaN(k, dPeriod);
  return { k, d };
}

function smaSkipNaN(values: number[], period: number): number[] {
  const start = values.findIndex((v) => !Number.isNaN(v));
  if (start < 0) return nanArray(values.length);
  const head = nanArray(start);
  return head.concat(sma(values.slice(start), period));
}

export function williamsR(c: Candle[], period = 14): number[] {
  const out = nanArray(c.length);
  for (let i = period - 1; i < c.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hh = Math.max(hh, c[j].h);
      ll = Math.min(ll, c[j].l);
    }
    out[i] = hh === ll ? -50 : ((hh - c[i].c) / (hh - ll)) * -100;
  }
  return out;
}

export function cci(c: Candle[], period = 20): number[] {
  const tp = c.map((x) => (x.h + x.l + x.c) / 3);
  const m = sma(tp, period);
  const out = nanArray(c.length);
  for (let i = period - 1; i < c.length; i++) {
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
    md /= period;
    out[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md);
  }
  return out;
}

export function adx(c: Candle[], period = 14) {
  const plusDM = nanArray(c.length);
  const minusDM = nanArray(c.length);
  const tr = trueRange(c);
  tr[0] = Number.NaN;
  for (let i = 1; i < c.length; i++) {
    const up = c[i].h - c[i - 1].h;
    const down = c[i - 1].l - c[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const trS = rma(tr, period);
  const pS = rma(plusDM, period);
  const mS = rma(minusDM, period);
  const plusDI = trS.map((t, i) => (100 * pS[i]) / t);
  const minusDI = trS.map((t, i) => (100 * mS[i]) / t);
  const dx = plusDI.map((p, i) => {
    const s = p + minusDI[i];
    return s === 0 ? 0 : (100 * Math.abs(p - minusDI[i])) / s;
  });
  return { adx: rma(dx, period), plusDI, minusDI };
}

export function obv(c: Candle[]): number[] {
  const out = new Array<number>(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    out[i] = out[i - 1] + (c[i].c > c[i - 1].c ? c[i].v : c[i].c < c[i - 1].c ? -c[i].v : 0);
  }
  return out;
}

/** Money Flow Index. */
export function mfi(c: Candle[], period = 14): number[] {
  const tp = c.map((x) => (x.h + x.l + x.c) / 3);
  const out = nanArray(c.length);
  for (let i = period; i < c.length; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * c[j].v;
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

/** Rolling VWAP over `period` bars (session-agnostic, works for 24/7 markets). */
export function vwap(c: Candle[], period = 20): number[] {
  const out = nanArray(c.length);
  for (let i = period - 1; i < c.length; i++) {
    let pv = 0;
    let vol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      pv += ((c[j].h + c[j].l + c[j].c) / 3) * c[j].v;
      vol += c[j].v;
    }
    out[i] = vol === 0 ? Number.NaN : pv / vol;
  }
  return out;
}

export function roc(values: number[], period = 10): number[] {
  return values.map((v, i) => (i < period ? Number.NaN : ((v - values[i - period]) / values[i - period]) * 100));
}

export function donchian(c: Candle[], period = 20) {
  const upper = nanArray(c.length);
  const lower = nanArray(c.length);
  for (let i = period - 1; i < c.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hh = Math.max(hh, c[j].h);
      ll = Math.min(ll, c[j].l);
    }
    upper[i] = hh;
    lower[i] = ll;
  }
  return { upper, lower, middle: upper.map((u, i) => (u + lower[i]) / 2) };
}

export function keltner(c: Candle[], period = 20, mult = 2, atrPeriod = 10) {
  const mid = ema(closes(c), period);
  const a = atr(c, atrPeriod);
  return { middle: mid, upper: mid.map((m, i) => m + mult * a[i]), lower: mid.map((m, i) => m - mult * a[i]) };
}

/** Supertrend. direction: 1 = up-trend, -1 = down-trend. */
export function supertrend(c: Candle[], period = 10, mult = 3) {
  const a = atr(c, period);
  const line = nanArray(c.length);
  const direction = nanArray(c.length);
  let upper = Number.NaN;
  let lower = Number.NaN;
  for (let i = 0; i < c.length; i++) {
    if (Number.isNaN(a[i])) continue;
    const hl2 = (c[i].h + c[i].l) / 2;
    const bu = hl2 + mult * a[i];
    const bl = hl2 - mult * a[i];
    const prevClose = i > 0 ? c[i - 1].c : c[i].c;
    upper = Number.isNaN(upper) || bu < upper || prevClose > upper ? bu : upper;
    lower = Number.isNaN(lower) || bl > lower || prevClose < lower ? bl : lower;
    const prevDir = i > 0 && !Number.isNaN(direction[i - 1]) ? direction[i - 1] : 1;
    let dir = prevDir;
    if (prevDir === 1 && c[i].c < lower) dir = -1;
    else if (prevDir === -1 && c[i].c > upper) dir = 1;
    direction[i] = dir;
    line[i] = dir === 1 ? lower : upper;
  }
  return { line, direction };
}

export function ichimoku(c: Candle[], tenkan = 9, kijun = 26, senkouB = 52) {
  const mid = (p: number) => donchian(c, p).middle;
  const t = mid(tenkan);
  const k = mid(kijun);
  const spanA = t.map((v, i) => (v + k[i]) / 2);
  const spanB = mid(senkouB);
  // Spans are plotted `kijun` bars ahead; here we return them un-shifted (value known at bar i).
  return { tenkan: t, kijun: k, spanA, spanB };
}

/** Classic floor pivots from the previous candle (use daily candles for daily pivots). */
export function pivots(prev: Candle) {
  const p = (prev.h + prev.l + prev.c) / 3;
  return { p, r1: 2 * p - prev.l, s1: 2 * p - prev.h, r2: p + (prev.h - prev.l), s2: p - (prev.h - prev.l) };
}

/** Rolling z-score of volume — spots unusual activity. */
export function volumeZ(c: Candle[], period = 20): number[] {
  const v = c.map((x) => x.v);
  const m = sma(v, period);
  const sd = stdev(v, period);
  return v.map((x, i) => (sd[i] ? (x - m[i]) / sd[i] : 0));
}

export const last = (arr: number[]): number => arr[arr.length - 1];
