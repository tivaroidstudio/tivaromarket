/** News, calendars, on-chain, whales, fundamentals. Every feed declares the keys it needs. */
import type { CalendarEvent, Fundamentals, NewsItem, OnchainMetric, WhaleTx } from '@tivaro/core';
import { fetchJson, fetchText, qs } from './http.ts';
import type { Env } from './candles.ts';

export type FeedKind = 'news' | 'calendar' | 'onchain' | 'whales' | 'fundamentals';

export interface Feed<T> {
  id: string;
  kind: FeedKind;
  label: string;
  requires: string[];
  /** Suggested refresh period in minutes. */
  everyMinutes: number;
  notes?: string;
  fetch(env: Env, ctx: FeedContext): Promise<T[]>;
}

export interface FeedContext {
  /** Symbols we track, e.g. ['AAPL','BTC'] — used by symbol-aware feeds. */
  stockSymbols: string[];
  cryptoSymbols: string[];
  now: number;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

// ======================= NEWS =======================

/** Curated free RSS feeds. Editable via settings key "rss.feeds". */
export const DEFAULT_RSS: { source: string; url: string; topics: string[] }[] = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', topics: ['crypto'] },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss', topics: ['crypto'] },
  { source: 'CNBC Markets', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', topics: ['stocks', 'macro'] },
  { source: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', topics: ['stocks', 'macro'] },
  { source: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', topics: ['stocks'] },
  { source: 'FXStreet', url: 'https://www.fxstreet.com/rss/news', topics: ['forex', 'commodities'] },
  { source: 'Investing.com', url: 'https://www.investing.com/rss/news.rss', topics: ['macro'] },
  { source: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', topics: ['central_bank'] },
  { source: 'ECB', url: 'https://www.ecb.europa.eu/rss/press.html', topics: ['central_bank'] },
  { source: 'OilPrice', url: 'https://oilprice.com/rss/main', topics: ['commodities'] },
];

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : undefined;
};

/** Minimal RSS 2.0 / Atom parser — good enough for headlines. */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out: NewsItem[] = [];
  for (const it of items) {
    const title = tag(it, 'title');
    if (!title) continue;
    const link = tag(it, 'link') || it.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const date = tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated') || tag(it, 'dc:date');
    const ts = date ? Date.parse(date) : Number.NaN;
    const summary = tag(it, 'description') || tag(it, 'summary');
    out.push({
      id: `rss:${hash(link || title)}`,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      source,
      title,
      url: link,
      summary: summary?.slice(0, 600),
    });
  }
  return out;
}

export const rssNews: Feed<NewsItem> = {
  id: 'rss',
  kind: 'news',
  label: 'RSS (CoinDesk, CNBC, FXStreet, Fed, ECB…)',
  requires: [],
  everyMinutes: 15,
  async fetch(env) {
    const feeds = env.TIVARO_RSS_FEEDS ? (JSON.parse(env.TIVARO_RSS_FEEDS) as typeof DEFAULT_RSS) : DEFAULT_RSS;
    const settled = await Promise.allSettled(feeds.map(async (f) => parseFeed(await fetchText(f.url, { retries: 1 }), f.source)));
    return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  },
};

/** GDELT: global news/geopolitics, free, no key. Good for "does this event move oil/gold/defence?" */
export const gdeltNews: Feed<NewsItem> = {
  id: 'gdelt',
  kind: 'news',
  label: 'GDELT (global events & geopolitics)',
  requires: [],
  everyMinutes: 30,
  async fetch(env) {
    const query = env.TIVARO_GDELT_QUERY ?? '(sanctions OR tariff OR OPEC OR "central bank" OR war OR ceasefire OR "rate cut" OR "rate hike") sourcelang:english';
    const r = await fetchJson<{ articles?: { url: string; title: string; seendate: string; domain: string }[] }>(
      `https://api.gdeltproject.org/api/v2/doc/doc?${qs({ query, mode: 'artlist', format: 'json', maxrecords: 75, timespan: '6h', sort: 'datedesc' })}`,
    );
    return (r.articles ?? []).map((a) => ({
      id: `gdelt:${hash(a.url)}`,
      ts: Date.parse(a.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')),
      source: `GDELT/${a.domain}`,
      title: a.title,
      url: a.url,
    }));
  },
};

export const finnhubNews: Feed<NewsItem> = {
  id: 'finnhub-news',
  kind: 'news',
  label: 'Finnhub market & company news',
  requires: ['FINNHUB_API_KEY'],
  everyMinutes: 20,
  async fetch(env, ctx) {
    const key = env.FINNHUB_API_KEY!;
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    type FN = { id: number; datetime: number; headline: string; summary: string; url: string; source: string; related: string };
    const general = await Promise.all(
      ['general', 'forex', 'crypto', 'merger'].map((category) => fetchJson<FN[]>(`https://finnhub.io/api/v1/news?${qs({ category, token: key })}`).catch(() => [] as FN[])),
    );
    const company = await Promise.all(
      ctx.stockSymbols.slice(0, 25).map((s) =>
        fetchJson<FN[]>(`https://finnhub.io/api/v1/company-news?${qs({ symbol: s, from: day(ctx.now - 2 * 86_400_000), to: day(ctx.now), token: key })}`).catch(() => [] as FN[]),
      ),
    );
    return [...general.flat(), ...company.flat()].map((n) => ({
      id: `finnhub:${n.id}`,
      ts: n.datetime * 1000,
      source: n.source || 'Finnhub',
      title: n.headline,
      url: n.url,
      summary: n.summary?.slice(0, 600),
      symbols: n.related ? n.related.split(',').filter(Boolean) : undefined,
    }));
  },
};

export const alpacaNews: Feed<NewsItem> = {
  id: 'alpaca-news',
  kind: 'news',
  label: 'Alpaca / Benzinga news',
  requires: ['ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY'],
  everyMinutes: 15,
  async fetch(env, ctx) {
    const r = await fetchJson<{ news: { id: number; headline: string; summary: string; url: string; created_at: string; symbols: string[]; source: string }[] }>(
      `https://data.alpaca.markets/v1beta1/news?${qs({ symbols: [...ctx.stockSymbols, ...ctx.cryptoSymbols.map((s) => `${s}USD`)].join(','), limit: 50, sort: 'desc' })}`,
      { headers: { 'APCA-API-KEY-ID': env.ALPACA_API_KEY_ID!, 'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET_KEY! } },
    );
    return r.news.map((n) => ({ id: `alpaca:${n.id}`, ts: Date.parse(n.created_at), source: n.source || 'Benzinga', title: n.headline, url: n.url, summary: n.summary, symbols: n.symbols }));
  },
};

export const cryptoPanic: Feed<NewsItem> = {
  id: 'cryptopanic',
  kind: 'news',
  label: 'CryptoPanic (crypto news + community votes)',
  requires: ['CRYPTOPANIC_API_KEY'],
  everyMinutes: 15,
  async fetch(env) {
    const r = await fetchJson<{ results: { id: number; title: string; published_at: string; url?: string; original_url?: string; currencies?: { code: string }[]; votes?: { positive: number; negative: number } }[] }>(
      `https://cryptopanic.com/api/developer/v2/posts/?${qs({ auth_token: env.CRYPTOPANIC_API_KEY, public: 'true' })}`,
    );
    return r.results.map((p) => {
      const pos = p.votes?.positive ?? 0;
      const neg = p.votes?.negative ?? 0;
      return {
        id: `cpanic:${p.id}`,
        ts: Date.parse(p.published_at),
        source: 'CryptoPanic',
        title: p.title,
        url: p.original_url ?? p.url,
        symbols: p.currencies?.map((c) => c.code),
        sentiment: pos + neg >= 3 ? (pos - neg) / (pos + neg) : undefined,
      };
    });
  },
};

// ======================= CALENDARS =======================

/** Forex Factory weekly economic calendar mirror (free JSON). */
export const ffCalendar: Feed<CalendarEvent> = {
  id: 'forexfactory',
  kind: 'calendar',
  label: 'Economic calendar (Forex Factory weekly)',
  requires: [],
  everyMinutes: 60,
  notes: 'This week + next week: CPI, NFP, rate decisions, PMIs with forecast/previous/actual.',
  async fetch() {
    type FF = { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string; actual?: string };
    const weeks = await Promise.allSettled(
      ['ff_calendar_thisweek.json', 'ff_calendar_nextweek.json'].map((f) => fetchJson<FF[]>(`https://nfs.faireconomy.media/${f}`, { retries: 1 })),
    );
    const imp = (s: string): 1 | 2 | 3 => (s === 'High' ? 3 : s === 'Medium' ? 2 : 1);
    return weeks
      .flatMap((w) => (w.status === 'fulfilled' ? w.value : []))
      .map((e) => {
        const ts = Date.parse(e.date);
        const centralBank = /rate|fomc|ecb|boe|boj|snb|rba|boc|rbnz|press conference|monetary/i.test(e.title);
        return {
          id: `ff:${e.country}:${ts}:${hash(e.title)}`,
          ts,
          kind: centralBank ? ('central_bank' as const) : ('macro' as const),
          title: e.title,
          country: e.country,
          importance: imp(e.impact),
          actual: e.actual || null,
          forecast: e.forecast || null,
          previous: e.previous || null,
          source: 'ForexFactory',
        };
      });
  },
};

export const finnhubEarnings: Feed<CalendarEvent> = {
  id: 'finnhub-earnings',
  kind: 'calendar',
  label: 'Earnings calendar (Finnhub)',
  requires: ['FINNHUB_API_KEY'],
  everyMinutes: 360,
  async fetch(env, ctx) {
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    const r = await fetchJson<{ earningsCalendar: { symbol: string; date: string; hour: string; epsEstimate: number | null; epsActual: number | null; revenueEstimate: number | null; quarter: number; year: number }[] }>(
      `https://finnhub.io/api/v1/calendar/earnings?${qs({ from: day(ctx.now - 3 * 86_400_000), to: day(ctx.now + 21 * 86_400_000), token: env.FINNHUB_API_KEY })}`,
    );
    const tracked = new Set(ctx.stockSymbols);
    return r.earningsCalendar.map((e) => {
      const hourOffset = e.hour === 'bmo' ? 12 : e.hour === 'amc' ? 21 : 16; // UTC approx
      return {
        id: `earn:${e.symbol}:${e.year}Q${e.quarter}`,
        ts: Date.parse(`${e.date}T00:00:00Z`) + hourOffset * 3_600_000,
        kind: 'earnings' as const,
        title: `${e.symbol} earnings Q${e.quarter} ${e.year} (${e.hour || 'n/a'})`,
        symbol: e.symbol,
        country: 'US',
        importance: tracked.has(e.symbol) ? (3 as const) : (1 as const),
        actual: e.epsActual,
        forecast: e.epsEstimate,
        previous: null,
        source: 'Finnhub',
      };
    });
  },
};

// ======================= ON-CHAIN & SENTIMENT =======================

export const fearGreed: Feed<OnchainMetric> = {
  id: 'fear-greed',
  kind: 'onchain',
  label: 'Crypto Fear & Greed (alternative.me)',
  requires: [],
  everyMinutes: 360,
  async fetch() {
    const r = await fetchJson<{ data: { value: string; value_classification: string; timestamp: string }[] }>('https://api.alternative.me/fng/?limit=60');
    return r.data.map((d) => ({ ts: Number(d.timestamp) * 1000, key: 'sentiment.crypto_fear_greed', value: Number(d.value), source: 'alternative.me', meta: { label: d.value_classification } }));
  },
};

export const mempool: Feed<OnchainMetric> = {
  id: 'mempool',
  kind: 'onchain',
  label: 'Bitcoin mempool fees & hashrate (mempool.space)',
  requires: [],
  everyMinutes: 30,
  async fetch(_env, ctx) {
    const [fees, hr] = await Promise.all([
      fetchJson<{ fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number }>('https://mempool.space/api/v1/fees/recommended'),
      fetchJson<{ currentHashrate: number; currentDifficulty: number }>('https://mempool.space/api/v1/mining/hashrate/3d'),
    ]);
    const ts = Math.floor(ctx.now / 1_800_000) * 1_800_000;
    return [
      { ts, key: 'btc.fee.fastest_sat_vb', value: fees.fastestFee, source: 'mempool.space' },
      { ts, key: 'btc.fee.hour_sat_vb', value: fees.hourFee, source: 'mempool.space' },
      { ts, key: 'btc.hashrate_ehs', value: hr.currentHashrate / 1e18, source: 'mempool.space' },
      { ts, key: 'btc.difficulty_t', value: hr.currentDifficulty / 1e12, source: 'mempool.space' },
    ];
  },
};

export const defiLlama: Feed<OnchainMetric> = {
  id: 'defillama',
  kind: 'onchain',
  label: 'DeFi TVL & stablecoin supply (DefiLlama)',
  requires: [],
  everyMinutes: 360,
  notes: 'Growing stablecoin supply = fresh liquidity entering crypto.',
  async fetch() {
    const [tvl, stables] = await Promise.all([
      fetchJson<{ date: number; tvl: number }[]>('https://api.llama.fi/v2/historicalChainTvl'),
      fetchJson<{ peggedAssets: { symbol: string; circulating?: { peggedUSD?: number } }[] }>('https://stablecoins.llama.fi/stablecoins?includePrices=false'),
    ]);
    const now = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const total = stables.peggedAssets.reduce((a, s) => a + (s.circulating?.peggedUSD ?? 0), 0);
    const pick = (s: string) => stables.peggedAssets.find((x) => x.symbol === s)?.circulating?.peggedUSD ?? 0;
    return [
      ...tvl.slice(-90).map((d) => ({ ts: d.date * 1000, key: 'defi.tvl_usd_bn', value: d.tvl / 1e9, source: 'DefiLlama' })),
      { ts: now, key: 'stablecoins.total_usd_bn', value: total / 1e9, source: 'DefiLlama' },
      { ts: now, key: 'stablecoins.usdt_usd_bn', value: pick('USDT') / 1e9, source: 'DefiLlama' },
      { ts: now, key: 'stablecoins.usdc_usd_bn', value: pick('USDC') / 1e9, source: 'DefiLlama' },
    ];
  },
};

/** Perp funding & open interest — crowding / leverage gauge. Free Binance futures endpoints. */
export const binanceDerivs: Feed<OnchainMetric> = {
  id: 'binance-derivs',
  kind: 'onchain',
  label: 'Perp funding rate & open interest (Binance futures)',
  requires: [],
  everyMinutes: 60,
  async fetch(_env, ctx) {
    const syms = ctx.cryptoSymbols.slice(0, 15).map((s) => `${s}USDT`);
    const out: OnchainMetric[] = [];
    const ts = Math.floor(ctx.now / 3_600_000) * 3_600_000;
    await Promise.all(
      syms.map(async (s) => {
        try {
          const [p, oi] = await Promise.all([
            fetchJson<{ lastFundingRate: string; markPrice: string }>(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s}`),
            fetchJson<{ openInterest: string }>(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${s}`),
          ]);
          const base = s.replace(/USDT$/, '').toLowerCase();
          out.push({ ts, key: `${base}.perp.funding_pct`, value: Number(p.lastFundingRate) * 100, source: 'binance-futures' });
          out.push({ ts, key: `${base}.perp.open_interest_usd_m`, value: (Number(oi.openInterest) * Number(p.markPrice)) / 1e6, source: 'binance-futures' });
        } catch {
          /* symbol without perp */
        }
      }),
    );
    return out;
  },
};

export const etherscanGas: Feed<OnchainMetric> = {
  id: 'etherscan',
  kind: 'onchain',
  label: 'Ethereum gas (Etherscan)',
  requires: ['ETHERSCAN_API_KEY'],
  everyMinutes: 30,
  async fetch(env, ctx) {
    const r = await fetchJson<{ status: string; result: { SafeGasPrice: string; ProposeGasPrice: string; FastGasPrice: string } }>(
      `https://api.etherscan.io/v2/api?${qs({ chainid: 1, module: 'gastracker', action: 'gasoracle', apikey: env.ETHERSCAN_API_KEY })}`,
    );
    const ts = Math.floor(ctx.now / 1_800_000) * 1_800_000;
    return [{ ts, key: 'eth.gas.propose_gwei', value: Number(r.result.ProposeGasPrice), source: 'etherscan' }];
  },
};

// ======================= WHALES =======================

export const whaleAlert: Feed<WhaleTx> = {
  id: 'whale-alert',
  kind: 'whales',
  label: 'Whale Alert (large on-chain transfers)',
  requires: ['WHALE_ALERT_API_KEY'],
  everyMinutes: 10,
  notes: 'Exchange inflows often precede selling; outflows suggest accumulation. Paid tiers for history.',
  async fetch(env, ctx) {
    type Owner = { owner?: string; owner_type?: string };
    const r = await fetchJson<{ result: string; transactions?: { id?: string; hash: string; blockchain: string; symbol: string; amount: number; amount_usd: number; timestamp: number; from: Owner; to: Owner }[] }>(
      `https://api.whale-alert.io/v1/transactions?${qs({ api_key: env.WHALE_ALERT_API_KEY, min_value: env.WHALE_MIN_USD ?? 1_000_000, start: Math.floor((ctx.now - 3_500_000) / 1000) })}`,
    );
    return (r.transactions ?? []).map((t) => {
      const fromEx = t.from.owner_type === 'exchange';
      const toEx = t.to.owner_type === 'exchange';
      return {
        id: `wa:${t.blockchain}:${t.hash}`,
        ts: t.timestamp * 1000,
        chain: t.blockchain,
        symbol: t.symbol.toUpperCase(),
        amount: t.amount,
        amountUsd: t.amount_usd,
        from: t.from.owner || t.from.owner_type,
        to: t.to.owner || t.to.owner_type,
        flow: toEx && !fromEx ? 'exchange_inflow' : fromEx && !toEx ? 'exchange_outflow' : t.from.owner_type ? 'transfer' : 'unknown',
        source: 'whale-alert',
      } satisfies WhaleTx;
    });
  },
};

// ======================= FUNDAMENTALS & MACRO =======================

const FRED_SERIES: Record<string, string> = {
  DGS10: 'us.yield_10y',
  DGS2: 'us.yield_2y',
  T10Y2Y: 'us.curve_10y2y',
  FEDFUNDS: 'us.fed_funds',
  CPIAUCSL: 'us.cpi_index',
  UNRATE: 'us.unemployment',
  DTWEXBGS: 'us.dollar_index_broad',
  VIXCLS: 'us.vix',
  BAMLH0A0HYM2: 'us.high_yield_spread',
};

export const fredMacro: Feed<OnchainMetric> = {
  id: 'fred',
  kind: 'onchain',
  label: 'Macro series (FRED: yields, CPI, Fed funds, VIX, USD)',
  requires: ['FRED_API_KEY'],
  everyMinutes: 720,
  async fetch(env) {
    const out: OnchainMetric[] = [];
    await Promise.all(
      Object.entries(FRED_SERIES).map(async ([id, key]) => {
        const r = await fetchJson<{ observations: { date: string; value: string }[] }>(
          `https://api.stlouisfed.org/fred/series/observations?${qs({ series_id: id, api_key: env.FRED_API_KEY, file_type: 'json', sort_order: 'desc', limit: 60 })}`,
        ).catch(() => ({ observations: [] }));
        for (const o of r.observations) if (o.value !== '.') out.push({ ts: Date.parse(`${o.date}T00:00:00Z`), key: `macro.${key}`, value: Number(o.value), source: 'FRED' });
      }),
    );
    return out;
  },
};

/** Finnhub basic financials — valuation, growth, margins. */
export async function finnhubFundamentals(symbol: string, instrumentId: string, env: Env): Promise<Fundamentals | null> {
  if (!env.FINNHUB_API_KEY) return null;
  const r = await fetchJson<{ metric?: Record<string, number | string | null> }>(
    `https://finnhub.io/api/v1/stock/metric?${qs({ symbol, metric: 'all', token: env.FINNHUB_API_KEY })}`,
  );
  if (!r.metric) return null;
  const keep = [
    'marketCapitalization', 'peTTM', 'peBasicExclExtraTTM', 'pbQuarterly', 'psTTM', 'epsGrowthTTMYoy', 'revenueGrowthTTMYoy',
    'grossMarginTTM', 'netProfitMarginTTM', 'roeTTM', 'currentRatioQuarterly', 'totalDebt/totalEquityQuarterly',
    'dividendYieldIndicatedAnnual', 'beta', '52WeekHigh', '52WeekLow', '52WeekPriceReturnDaily', 'epsTTM',
  ];
  const data: Record<string, number | string | null> = {};
  for (const k of keep) if (k in r.metric) data[k] = r.metric[k];
  return { instrumentId, ts: Date.now(), source: 'finnhub', data };
}

export const FEEDS = {
  news: [rssNews, gdeltNews, finnhubNews, alpacaNews, cryptoPanic],
  calendar: [ffCalendar, finnhubEarnings],
  onchain: [fearGreed, mempool, defiLlama, binanceDerivs, etherscanGas, fredMacro],
  whales: [whaleAlert],
} as const;
