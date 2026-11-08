/**
 * Compact technical snapshot for an instrument/timeframe. This is what the AI agent
 * reads instead of thousands of raw candles (cheap in tokens, consistent across models).
 */
import * as I from './indicators.ts';
import type { Candle, Timeframe } from './types.ts';

export interface TechnicalSnapshot {
  timeframe: Timeframe;
  bars: number;
  lastTime: number;
  close: number;
  changePct: { bar: number; bars5: number; bars20: number };
  trend: {
    ema20: number;
    ema50: number;
    ema200: number | null;
    /** -3..3: sign sum of close>ema20, ema20>ema50, ema50>ema200 */
    score: number;
    supertrend: 'up' | 'down' | null;
    adx: number | null;
    plusDI: number | null;
    minusDI: number | null;
  };
  momentum: {
    rsi14: number | null;
    macdHist: number | null;
    macdCross: 'bull' | 'bear' | null;
    stochK: number | null;
    stochD: number | null;
    cci20: number | null;
    roc10: number | null;
    mfi14: number | null;
  };
  volatility: {
    atr14: number | null;
    atrPct: number | null;
    bbPercentB: number | null;
    bbBandwidth: number | null;
    /** Bandwidth in the lowest 10% of the last 120 bars → potential breakout. */
    squeeze: boolean;
  };
  volume: { zScore: number | null; obvSlope20: number | null; vwap20: number | null };
  levels: { donchianHigh20: number | null; donchianLow20: number | null; pivot: ReturnType<typeof I.pivots> | null };
  signals: string[];
}

const num = (v: number): number | null => (Number.isFinite(v) ? round(v) : null);
export function round(v: number, digits = 6): number {
  if (!Number.isFinite(v)) return v;
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 2 : abs >= 1 ? 4 : digits;
  return Number(v.toFixed(d));
}

export function technicalSnapshot(candles: Candle[], timeframe: Timeframe): TechnicalSnapshot | null {
  if (candles.length < 30) return null;
  const n = candles.length;
  const cl = I.closes(candles);
  const close = cl[n - 1];
  const pct = (back: number) => (n > back ? round(((close - cl[n - 1 - back]) / cl[n - 1 - back]) * 100, 4) : 0);

  const e20 = I.ema(cl, 20);
  const e50 = I.ema(cl, 50);
  const e200 = I.ema(cl, 200);
  const st = I.supertrend(candles);
  const dx = I.adx(candles);
  const r = I.rsi(cl);
  const m = I.macd(cl);
  const sto = I.stochastic(candles);
  const bb = I.bollinger(cl);
  const a = I.atr(candles);
  const ob = I.obv(candles);
  const don = I.donchian(candles, 20);
  const vz = I.volumeZ(candles);

  const sgn = (b: boolean | null) => (b === null ? 0 : b ? 1 : -1);
  const lastE200 = I.last(e200);
  const score =
    sgn(Number.isFinite(I.last(e20)) ? close > I.last(e20) : null) +
    sgn(Number.isFinite(I.last(e50)) ? I.last(e20) > I.last(e50) : null) +
    sgn(Number.isFinite(lastE200) ? I.last(e50) > lastE200 : null);

  const hist = m.histogram;
  const macdCross =
    Number.isFinite(hist[n - 1]) && Number.isFinite(hist[n - 2])
      ? hist[n - 2] <= 0 && hist[n - 1] > 0
        ? 'bull'
        : hist[n - 2] >= 0 && hist[n - 1] < 0
          ? 'bear'
          : null
      : null;

  const bwWindow = bb.bandwidth.slice(-120).filter(Number.isFinite);
  const bwNow = I.last(bb.bandwidth);
  const squeeze =
    bwWindow.length >= 40 && Number.isFinite(bwNow) && bwNow <= [...bwWindow].sort((x, y) => x - y)[Math.floor(bwWindow.length * 0.1)];

  const obvSlope = n > 20 ? ob[n - 1] - ob[n - 21] : Number.NaN;
  const stDir = I.last(st.direction);

  const snap: TechnicalSnapshot = {
    timeframe,
    bars: n,
    lastTime: candles[n - 1].t,
    close,
    changePct: { bar: pct(1), bars5: pct(5), bars20: pct(20) },
    trend: {
      ema20: round(I.last(e20)),
      ema50: round(I.last(e50)),
      ema200: num(lastE200),
      score,
      supertrend: stDir === 1 ? 'up' : stDir === -1 ? 'down' : null,
      adx: num(I.last(dx.adx)),
      plusDI: num(I.last(dx.plusDI)),
      minusDI: num(I.last(dx.minusDI)),
    },
    momentum: {
      rsi14: num(I.last(r)),
      macdHist: num(I.last(hist)),
      macdCross,
      stochK: num(I.last(sto.k)),
      stochD: num(I.last(sto.d)),
      cci20: num(I.last(I.cci(candles))),
      roc10: num(I.last(I.roc(cl))),
      mfi14: num(I.last(I.mfi(candles))),
    },
    volatility: {
      atr14: num(I.last(a)),
      atrPct: num((I.last(a) / close) * 100),
      bbPercentB: num(I.last(bb.percentB)),
      bbBandwidth: num(bwNow),
      squeeze,
    },
    volume: { zScore: num(I.last(vz)), obvSlope20: num(obvSlope), vwap20: num(I.last(I.vwap(candles))) },
    levels: {
      donchianHigh20: num(don.upper[n - 2]),
      donchianLow20: num(don.lower[n - 2]),
      pivot: n >= 2 ? mapPivot(I.pivots(candles[n - 2])) : null,
    },
    signals: [],
  };
  snap.signals = describeSignals(snap);
  return snap;
}

function mapPivot(p: ReturnType<typeof I.pivots>) {
  return { p: round(p.p), r1: round(p.r1), s1: round(p.s1), r2: round(p.r2), s2: round(p.s2) };
}

/** Human/LLM-readable flags. Deliberately factual, not advice. */
export function describeSignals(s: TechnicalSnapshot): string[] {
  const out: string[] = [];
  const { trend, momentum, volatility, volume, levels } = s;
  if (trend.score >= 2) out.push('trend: bullish EMA stack');
  if (trend.score <= -2) out.push('trend: bearish EMA stack');
  if (trend.adx !== null) out.push(trend.adx >= 25 ? `trend strength: strong (ADX ${trend.adx})` : `trend strength: weak/ranging (ADX ${trend.adx})`);
  if (momentum.rsi14 !== null && momentum.rsi14 >= 70) out.push(`RSI overbought (${momentum.rsi14})`);
  if (momentum.rsi14 !== null && momentum.rsi14 <= 30) out.push(`RSI oversold (${momentum.rsi14})`);
  if (momentum.macdCross) out.push(`MACD ${momentum.macdCross}ish cross on last bar`);
  if (volatility.squeeze) out.push('Bollinger squeeze (low volatility, breakout risk)');
  if (volatility.bbPercentB !== null && volatility.bbPercentB > 1) out.push('close above upper Bollinger band');
  if (volatility.bbPercentB !== null && volatility.bbPercentB < 0) out.push('close below lower Bollinger band');
  if (volume.zScore !== null && volume.zScore >= 2.5) out.push(`unusual volume (z=${volume.zScore})`);
  if (levels.donchianHigh20 !== null && s.close > levels.donchianHigh20) out.push('20-bar breakout up');
  if (levels.donchianLow20 !== null && s.close < levels.donchianLow20) out.push('20-bar breakdown');
  return out;
}
