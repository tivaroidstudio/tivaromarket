/** Candle providers. Each maps our timeframes onto the provider's native ones. */
import { TIMEFRAME_MS, type Candle, type Instrument, type Timeframe } from '@tivaro/core';
import { fetchJson, qs } from './http.ts';

export type Env = Record<string, string | undefined>;

export interface CandleProvider {
  id: string;
  label: string;
  assetClasses: Instrument['assetClass'][];
  /** Env vars that must be set. Empty = free/no key. */
  requires: string[];
  notes?: string;
  fetchCandles(inst: Instrument, tf: Timeframe, opts: { since?: number; limit?: number }, env: Env): Promise<Candle[]>;
}

const sym = (i: Instrument) => i.providerSymbol ?? i.symbol;

/** Drop the still-forming candle so the forward test only ever sees closed bars. */
export function onlyClosed(candles: Candle[], tf: Timeframe, now = Date.now()): Candle[] {
  return candles.filter((c) => c.t + TIMEFRAME_MS[tf] <= now);
}

/** Aggregate lower-timeframe candles into a higher one (e.g. 1h → 4h, 1d → 1w). Buckets aligned to UTC epoch (weeks to Monday). */
export function resample(candles: Candle[], to: Timeframe): Candle[] {
  const step = TIMEFRAME_MS[to];
  const offset = to === '1w' ? 4 * 86_400_000 : 0; // 1970-01-01 was a Thursday → shift to Monday
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of candles) {
    const bucket = Math.floor((c.t - offset) / step) * step + offset;
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur);
      cur = { t: bucket, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------------- Binance (spot, free) ----------------
export const binance: CandleProvider = {
  id: 'binance',
  label: 'Binance spot',
  assetClasses: ['crypto'],
  requires: [],
  notes: 'Free public klines. Blocked from US IPs (HTTP 451) — use Bybit then.',
  async fetchCandles(inst, tf, { since, limit = 1000 }) {
    const rows = await fetchJson<unknown[][]>(
      `https://api.binance.com/api/v3/klines?${qs({ symbol: sym(inst), interval: tf, limit: Math.min(limit, 1000), startTime: since })}`,
    );
    return rows.map((r) => ({ t: Number(r[0]), o: +r[1]!, h: +r[2]!, l: +r[3]!, c: +r[4]!, v: +r[5]! }));
  },
};

// ---------------- Bybit (spot, free) ----------------
const BYBIT_TF: Record<Timeframe, string> = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' };
export const bybit: CandleProvider = {
  id: 'bybit',
  label: 'Bybit spot',
  assetClasses: ['crypto'],
  requires: [],
  async fetchCandles(inst, tf, { since, limit = 1000 }) {
    const r = await fetchJson<{ retCode: number; retMsg: string; result: { list: string[][] } }>(
      `https://api.bybit.com/v5/market/kline?${qs({ category: 'spot', symbol: sym(inst), interval: BYBIT_TF[tf], limit: Math.min(limit, 1000), start: since })}`,
    );
    if (r.retCode !== 0) throw new Error(`bybit: ${r.retMsg}`);
    return r.result.list.map((x) => ({ t: Number(x[0]), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] })).sort((a, b) => a.t - b.t);
  },
};

// ---------------- Yahoo Finance chart (free, unofficial) ----------------
const YAHOO_TF: Record<Timeframe, { interval: string; range: string; resampleFrom?: Timeframe }> = {
  '1m': { interval: '1m', range: '7d' },
  '5m': { interval: '5m', range: '60d' },
  '15m': { interval: '15m', range: '60d' },
  '30m': { interval: '30m', range: '60d' },
  '1h': { interval: '60m', range: '730d' },
  '4h': { interval: '60m', range: '730d', resampleFrom: '1h' },
  '1d': { interval: '1d', range: '10y' },
  '1w': { interval: '1wk', range: '10y' },
};

interface YahooChart {
  chart: {
    result?: { timestamp?: number[]; indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] } }[];
    error?: { description: string } | null;
  };
}

export const yahoo: CandleProvider = {
  id: 'yahoo',
  label: 'Yahoo Finance (unofficial)',
  assetClasses: ['stock', 'etf', 'index', 'forex', 'commodity', 'crypto', 'bond'],
  requires: [],
  notes: 'Free, broad coverage (stocks, ETFs, indices ^GSPC, FX EURUSD=X, futures GC=F). Unofficial endpoint, may rate-limit.',
  async fetchCandles(inst, tf, { since }) {
    const m = YAHOO_TF[tf];
    const params = since
      ? { interval: m.interval, period1: Math.floor(since / 1000), period2: Math.floor(Date.now() / 1000) }
      : { interval: m.interval, range: m.range };
    const r = await fetchJson<YahooChart>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym(inst))}?${qs({ ...params, includePrePost: 'false' })}`);
    if (r.chart.error) throw new Error(`yahoo: ${r.chart.error.description}`);
    const res = r.chart.result?.[0];
    if (!res?.timestamp) return [];
    const q = res.indicators.quote[0];
    const out: Candle[] = [];
    res.timestamp.forEach((ts, i) => {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) return;
      out.push({ t: ts * 1000, o, h, l, c, v: q.volume[i] ?? 0 });
    });
    return m.resampleFrom ? resample(out, tf) : out;
  },
};

// ---------------- Alpaca market data (free key, IEX feed) ----------------
const ALPACA_TF: Record<Timeframe, string> = { '1m': '1Min', '5m': '5Min', '15m': '15Min', '30m': '30Min', '1h': '1Hour', '4h': '4Hour', '1d': '1Day', '1w': '1Week' };
export const alpaca: CandleProvider = {
  id: 'alpaca',
  label: 'Alpaca (US stocks/ETFs)',
  assetClasses: ['stock', 'etf'],
  requires: ['ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY'],
  notes: 'Free account. IEX feed by default; paper-trading API ready for later live execution.',
  async fetchCandles(inst, tf, { since, limit = 1000 }, env) {
    const start = new Date(since ?? Date.now() - limit * TIMEFRAME_MS[tf] * 1.6).toISOString();
    const out: Candle[] = [];
    let token: string | undefined;
    do {
      const r = await fetchJson<{ bars: Record<string, { t: string; o: number; h: number; l: number; c: number; v: number }[]>; next_page_token?: string }>(
        `https://data.alpaca.markets/v2/stocks/bars?${qs({ symbols: sym(inst), timeframe: ALPACA_TF[tf], start, limit: 10000, feed: env.ALPACA_FEED ?? 'iex', adjustment: 'all', page_token: token })}`,
        { headers: { 'APCA-API-KEY-ID': env.ALPACA_API_KEY_ID!, 'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET_KEY! } },
      );
      for (const b of r.bars?.[sym(inst)] ?? []) out.push({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      token = r.next_page_token ?? undefined;
    } while (token && out.length < 20_000);
    return out;
  },
};

// ---------------- OANDA v20 (forex, metals, CFD indices & commodities) ----------------
const OANDA_TF: Record<Timeframe, string> = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D', '1w': 'W' };
export const oanda: CandleProvider = {
  id: 'oanda',
  label: 'OANDA (FX, metals, CFDs)',
  assetClasses: ['forex', 'commodity', 'index', 'bond'],
  requires: ['OANDA_API_TOKEN'],
  notes: 'Free practice account works. Symbols like EUR_USD, XAU_USD, BCO_USD, SPX500_USD, DE30_EUR.',
  async fetchCandles(inst, tf, { since, limit = 1000 }, env) {
    const host = env.OANDA_ENV === 'live' ? 'api-fxtrade.oanda.com' : 'api-fxpractice.oanda.com';
    const params = since
      ? { granularity: OANDA_TF[tf], price: 'M', from: new Date(since).toISOString(), count: Math.min(limit, 5000) }
      : { granularity: OANDA_TF[tf], price: 'M', count: Math.min(limit, 5000) };
    const r = await fetchJson<{ candles: { time: string; volume: number; complete: boolean; mid: { o: string; h: string; l: string; c: string } }[] }>(
      `https://${host}/v3/instruments/${sym(inst)}/candles?${qs({ ...params, dailyAlignment: 0, alignmentTimezone: 'UTC', weeklyAlignment: 'Monday' })}`,
      { headers: { authorization: `Bearer ${env.OANDA_API_TOKEN}` } },
    );
    return r.candles.filter((c) => c.complete).map((c) => ({ t: Date.parse(c.time), o: +c.mid.o, h: +c.mid.h, l: +c.mid.l, c: +c.mid.c, v: c.volume }));
  },
};

/** Deterministic offline data for the demo / tests. Never mixed with real providers. */
export const synthetic: CandleProvider = {
  id: 'synthetic',
  label: 'Synthetic (demo only)',
  assetClasses: ['crypto', 'stock', 'etf', 'index', 'forex', 'commodity'],
  requires: [],
  notes: 'Random-walk data for offline demos. Not market data.',
  async fetchCandles() {
    return [];
  },
};

export const CANDLE_PROVIDERS: Record<string, CandleProvider> = { binance, bybit, yahoo, alpaca, oanda, synthetic };
