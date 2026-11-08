/** MCP tools → TivaroMarket worker API. */
const API = (process.env.TIVARO_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const AGENT = process.env.TIVARO_AGENT_ID ?? 'external-agent';

async function api(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(process.env.TIVARO_API_TOKEN ? { authorization: `Bearer ${process.env.TIVARO_API_TOKEN}` } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`TivaroMarket API ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const q = (p: Record<string, unknown>) =>
  Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`)
    .join('&');

const TF = { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] };

export const TOOLS: { name: string; description: string; inputSchema: Record<string, unknown>; run: (a: any) => Promise<unknown> }[] = [
  {
    name: 'list_instruments',
    description: 'All tracked instruments (crypto, stocks, ETFs, indices, forex, commodities) with last price and 1d change.',
    inputSchema: { type: 'object', properties: { assetClass: { type: 'string' } } },
    run: async (a) => {
      const list = (await api('/api/instruments')) as { assetClass: string; enabled: boolean }[];
      return list.filter((i) => i.enabled && (!a.assetClass || i.assetClass === a.assetClass));
    },
  },
  {
    name: 'get_market_brief',
    description:
      'The full research brief the built-in agents receive: multi-timeframe technicals (EMA, RSI, MACD, ADX, Supertrend, Bollinger, ATR, volume), fundamentals, related news, upcoming events, whale flows, on-chain/macro metrics and YOUR track record. Max ~8 instruments per call.',
    inputSchema: { type: 'object', properties: { instrumentIds: { type: 'array', items: { type: 'string' } }, timeframe: TF }, required: ['timeframe'] },
    run: (a) => api(`/api/brief?${q({ instrumentIds: a.instrumentIds, tf: a.timeframe, agentId: AGENT })}`),
  },
  {
    name: 'get_candles',
    description: 'OHLCV candles (closed bars, ascending).',
    inputSchema: { type: 'object', properties: { instrumentId: { type: 'string' }, timeframe: TF, limit: { type: 'number' } }, required: ['instrumentId', 'timeframe'] },
    run: (a) => api(`/api/candles?${q({ instrumentId: a.instrumentId, tf: a.timeframe, limit: a.limit ?? 200 })}`),
  },
  {
    name: 'get_indicators',
    description: 'Indicator series (EMA20/50/200, Bollinger, RSI, MACD, Supertrend, ATR, VWAP) + technical snapshot.',
    inputSchema: { type: 'object', properties: { instrumentId: { type: 'string' }, timeframe: TF, limit: { type: 'number' } }, required: ['instrumentId', 'timeframe'] },
    run: (a) => api(`/api/indicators?${q({ instrumentId: a.instrumentId, tf: a.timeframe, limit: a.limit ?? 100 })}`),
  },
  {
    name: 'get_news',
    description: 'Latest stored headlines (RSS, GDELT, Finnhub, Benzinga, CryptoPanic). Filter by symbol or text.',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number' } } },
    run: (a) => api(`/api/news?${q({ symbol: a.symbol, q: a.query, limit: a.limit ?? 40 })}`),
  },
  {
    name: 'get_calendar',
    description: 'Economic calendar (CPI, NFP, rate decisions, PMIs…) and earnings. importance 3 = high.',
    inputSchema: { type: 'object', properties: { days: { type: 'number' }, minImportance: { type: 'number' }, kind: { type: 'string' } } },
    run: (a) => api(`/api/events?${q({ from: Date.now() - 86_400_000, to: Date.now() + (a.days ?? 7) * 86_400_000, minImportance: a.minImportance ?? 2, kind: a.kind })}`),
  },
  {
    name: 'get_onchain',
    description: 'Latest on-chain, derivatives (funding, open interest), sentiment (Fear & Greed), DeFi/stablecoin and macro (FRED) metrics, with 24h change. Pass key for a time series.',
    inputSchema: { type: 'object', properties: { prefix: { type: 'string' }, key: { type: 'string' } } },
    run: (a) => api(`/api/onchain?${q({ prefix: a.prefix, key: a.key })}`),
  },
  {
    name: 'get_whales',
    description: 'Large on-chain transfers; flow=exchange_inflow/outflow.',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, minUsd: { type: 'number' }, limit: { type: 'number' } } },
    run: (a) => api(`/api/whales?${q({ symbol: a.symbol, minUsd: a.minUsd, limit: a.limit ?? 50 })}`),
  },
  {
    name: 'submit_decisions',
    description:
      'Record trading decisions into the paper portfolio + forward test. action buy|sell|hold|close; buy/sell need stopLoss & takeProfit (absolute prices). confidence 0..1, horizonBars, rationale (Polish preferred), evidence[], sources[] (news/event ids or URLs).',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Your model name, for the audit trail' },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              instrumentId: { type: 'string' }, timeframe: TF, action: { type: 'string', enum: ['buy', 'sell', 'hold', 'close'] },
              confidence: { type: 'number' }, entryPrice: { type: 'number' }, stopLoss: { type: 'number' }, takeProfit: { type: 'number' },
              horizonBars: { type: 'number' }, sizePct: { type: 'number' }, rationale: { type: 'string' },
              evidence: { type: 'array', items: { type: 'string' } }, sources: { type: 'array', items: { type: 'string' } },
            },
            required: ['instrumentId', 'timeframe', 'action', 'confidence', 'rationale'],
          },
        },
      },
      required: ['decisions'],
    },
    run: (a) => api('/api/decisions', { method: 'POST', body: { agentId: AGENT, model: a.model, decisions: a.decisions } }),
  },
  {
    name: 'get_track_record',
    description: 'Your forward-test stats: win rate, profit factor, calibration by confidence, paper portfolio, open positions.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const p = await api(`/api/portfolio?${q({ agentId: AGENT })}`);
      return { stats: p.stats, equity: p.equity, returnPct: p.returnPct, maxDrawdownPct: p.maxDrawdownPct, open: p.state.open, rejected: p.rejected.slice(-10) };
    },
  },
  {
    name: 'get_leaderboard',
    description: 'Forward-test leaderboard of all agents (built-in + external) and stats per timeframe and asset class.',
    inputSchema: { type: 'object', properties: { sinceDays: { type: 'number' } } },
    run: (a) => api(`/api/leaderboard?${q({ since: a.sinceDays ? Date.now() - a.sinceDays * 86_400_000 : 0 })}`),
  },
];

export async function callTool(name: string, args: unknown) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`unknown tool ${name}`);
  return t.run(args ?? {});
}
