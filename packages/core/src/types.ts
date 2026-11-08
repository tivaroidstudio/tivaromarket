/** Shared domain types for TivaroMarket. */

export type AssetClass = 'crypto' | 'stock' | 'etf' | 'index' | 'forex' | 'commodity' | 'bond' | 'other';

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '1d': 86_400_000,
  '1w': 7 * 86_400_000,
};

export function isTimeframe(v: unknown): v is Timeframe {
  return typeof v === 'string' && (TIMEFRAMES as readonly string[]).includes(v);
}

export interface Instrument {
  /** Stable id, e.g. "crypto:BTCUSDT", "stock:AAPL", "forex:EUR_USD". */
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** Data provider id used for candles (see @tivaro/data registry). */
  provider: string;
  /** Provider-specific symbol, if different from `symbol`. */
  providerSymbol?: string;
  quote?: string;
  /** Where a human would execute it (e.g. "binance", "alpaca", "oanda", "xtb-manual"). */
  venue?: string;
  tags?: string[];
}

export interface Candle {
  /** Open time, unix ms (UTC). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Action = 'buy' | 'sell' | 'hold' | 'close';

/** A structured trading decision produced by an AI agent (or a human). */
export interface Decision {
  id: string;
  agentId: string;
  /** Model/provider string for audit, e.g. "anthropic/claude-opus-5-5". */
  model?: string;
  instrumentId: string;
  timeframe: Timeframe;
  action: Action;
  /** 0..1 — how sure the agent is. Used for calibration stats. */
  confidence: number;
  /** Optional limit price; market entry at next bar open when omitted. */
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Bars of `timeframe` after which an open trade is closed at market. */
  horizonBars: number;
  /** Fraction of paper equity the agent wants to allocate (0..1). Risk engine may cut it. */
  sizePct?: number;
  rationale: string;
  /** Short evidence bullets: indicators, news ids, on-chain facts used. */
  evidence?: string[];
  /** Ids of news/events the decision is based on (for attribution). */
  sources?: string[];
  /** Unix ms when the decision was made. Entry is never before this. */
  createdAt: number;
  /** Last known price when the decision was made (informational). */
  priceAtDecision?: number;
  /** Set when the decision was produced in a replay/backtest rather than live. */
  mode?: 'live' | 'replay';
}

export type ResultStatus = 'pending' | 'open' | 'closed' | 'expired' | 'not_filled' | 'skipped';
export type ExitReason = 'stop' | 'target' | 'horizon' | 'opposite' | 'manual' | null;

/** Forward-test outcome of a single decision, recomputed as new candles arrive. */
export interface DecisionResult {
  decisionId: string;
  status: ResultStatus;
  side: 'long' | 'short' | 'flat';
  entryTime?: number;
  entryPrice?: number;
  exitTime?: number;
  exitPrice?: number;
  exitReason: ExitReason;
  /** Net return after fees & slippage (fraction, 0.01 = +1%). For open trades: mark-to-market. */
  returnPct: number;
  /** Return in units of initial risk (needs stop loss), else null. */
  rMultiple: number | null;
  /** Max favourable / adverse excursion while in trade (fractions). */
  mfePct: number;
  maePct: number;
  barsHeld: number;
  /** Raw price change over the horizon from decision price — scores "hold" & direction accuracy. */
  horizonMovePct: number | null;
  /** Did the call get the direction right over the horizon? null if not yet known. */
  directionCorrect: boolean | null;
  updatedAt: number;
}

export interface NewsItem {
  id: string;
  ts: number;
  source: string;
  title: string;
  url?: string;
  summary?: string;
  symbols?: string[];
  /** -1..1 if a provider gives it. */
  sentiment?: number;
}

export type EventKind = 'macro' | 'earnings' | 'dividend' | 'ipo' | 'crypto' | 'central_bank' | 'other';

export interface CalendarEvent {
  id: string;
  ts: number;
  kind: EventKind;
  title: string;
  country?: string;
  symbol?: string;
  importance: 1 | 2 | 3;
  actual?: string | number | null;
  forecast?: string | number | null;
  previous?: string | number | null;
  source: string;
}

export interface OnchainMetric {
  ts: number;
  /** e.g. "btc.mempool.fee_fastest", "eth.gas.propose", "defi.tvl.total", "sentiment.fear_greed". */
  key: string;
  value: number;
  source: string;
  meta?: Record<string, unknown>;
}

export interface WhaleTx {
  id: string;
  ts: number;
  chain: string;
  symbol: string;
  amount: number;
  amountUsd: number;
  from?: string;
  to?: string;
  /** e.g. "exchange_inflow" (often bearish), "exchange_outflow", "transfer". */
  flow: 'exchange_inflow' | 'exchange_outflow' | 'transfer' | 'unknown';
  source: string;
}

export interface Fundamentals {
  instrumentId: string;
  ts: number;
  source: string;
  data: Record<string, number | string | null>;
}
