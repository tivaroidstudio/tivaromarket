/**
 * Default instrument universe. Candles come from free providers by default (Binance for
 * crypto, Yahoo for everything else); switch an instrument to Alpaca/OANDA once keys are set.
 * `venue: 'xtb-manual'` marks CFDs you would execute by hand in xStation (XTB has no API since 2025-03-14).
 */
import type { Instrument } from '@tivaro/core';

const crypto = (s: string, name: string): Instrument => ({
  id: `crypto:${s}USDT`, symbol: `${s}USDT`, name, assetClass: 'crypto', provider: 'binance', quote: 'USDT', venue: 'binance', tags: [s],
});
const y = (cls: Instrument['assetClass'], id: string, ysym: string, name: string, venue = 'xtb-manual', tags: string[] = []): Instrument => ({
  id: `${cls}:${id}`, symbol: id, name, assetClass: cls, provider: 'yahoo', providerSymbol: ysym, venue, tags,
});

export const DEFAULT_UNIVERSE: Instrument[] = [
  crypto('BTC', 'Bitcoin'),
  crypto('ETH', 'Ethereum'),
  crypto('SOL', 'Solana'),
  crypto('BNB', 'BNB'),
  crypto('XRP', 'XRP'),
  crypto('DOGE', 'Dogecoin'),

  y('stock', 'AAPL', 'AAPL', 'Apple', 'alpaca'),
  y('stock', 'MSFT', 'MSFT', 'Microsoft', 'alpaca'),
  y('stock', 'NVDA', 'NVDA', 'NVIDIA', 'alpaca'),
  y('stock', 'AMZN', 'AMZN', 'Amazon', 'alpaca'),
  y('stock', 'GOOGL', 'GOOGL', 'Alphabet', 'alpaca'),
  y('stock', 'META', 'META', 'Meta Platforms', 'alpaca'),
  y('stock', 'TSLA', 'TSLA', 'Tesla', 'alpaca'),
  y('stock', 'CDR', 'CDR.WA', 'CD Projekt (GPW)', 'xtb-manual', ['PL']),
  y('stock', 'PKN', 'PKN.WA', 'Orlen (GPW)', 'xtb-manual', ['PL']),

  y('etf', 'SPY', 'SPY', 'SPDR S&P 500', 'alpaca'),
  y('etf', 'QQQ', 'QQQ', 'Invesco QQQ', 'alpaca'),
  y('etf', 'IWM', 'IWM', 'Russell 2000', 'alpaca'),
  y('etf', 'GLD', 'GLD', 'Gold ETF', 'alpaca'),
  y('etf', 'TLT', 'TLT', '20Y+ Treasuries', 'alpaca'),

  y('index', 'SPX', '^GSPC', 'S&P 500'),
  y('index', 'NDX', '^NDX', 'Nasdaq 100'),
  y('index', 'DJI', '^DJI', 'Dow Jones'),
  y('index', 'DAX', '^GDAXI', 'DAX 40'),
  y('index', 'WIG20', 'WIG20.WA', 'WIG20', 'xtb-manual', ['PL']),
  y('index', 'VIX', '^VIX', 'VIX volatility', 'none'),

  y('forex', 'EURUSD', 'EURUSD=X', 'EUR/USD'),
  y('forex', 'GBPUSD', 'GBPUSD=X', 'GBP/USD'),
  y('forex', 'USDJPY', 'USDJPY=X', 'USD/JPY'),
  y('forex', 'EURPLN', 'EURPLN=X', 'EUR/PLN', 'xtb-manual', ['PL']),
  y('forex', 'USDPLN', 'USDPLN=X', 'USD/PLN', 'xtb-manual', ['PL']),
  y('forex', 'DXY', 'DX-Y.NYB', 'US Dollar Index', 'none'),

  y('commodity', 'GOLD', 'GC=F', 'Gold'),
  y('commodity', 'SILVER', 'SI=F', 'Silver'),
  y('commodity', 'WTI', 'CL=F', 'Crude oil WTI'),
  y('commodity', 'BRENT', 'BZ=F', 'Brent oil'),
  y('commodity', 'NATGAS', 'NG=F', 'Natural gas'),
  y('commodity', 'COPPER', 'HG=F', 'Copper'),
  y('commodity', 'WHEAT', 'ZW=F', 'Wheat'),
];

/** Mapping for switching Yahoo instruments to OANDA when OANDA_API_TOKEN is set. */
export const OANDA_SYMBOLS: Record<string, string> = {
  'forex:EURUSD': 'EUR_USD', 'forex:GBPUSD': 'GBP_USD', 'forex:USDJPY': 'USD_JPY', 'forex:EURPLN': 'EUR_PLN', 'forex:USDPLN': 'USD_PLN',
  'commodity:GOLD': 'XAU_USD', 'commodity:SILVER': 'XAG_USD', 'commodity:WTI': 'WTICO_USD', 'commodity:BRENT': 'BCO_USD',
  'commodity:NATGAS': 'NATGAS_USD', 'commodity:COPPER': 'XCU_USD', 'commodity:WHEAT': 'WHEAT_USD',
  'index:SPX': 'SPX500_USD', 'index:NDX': 'NAS100_USD', 'index:DJI': 'US30_USD', 'index:DAX': 'DE30_EUR',
};

/** Crypto base symbols, stock tickers — for symbol-aware feeds. */
export function feedSymbols(list: Instrument[]) {
  return {
    cryptoSymbols: list.filter((i) => i.assetClass === 'crypto').map((i) => (i.tags?.[0] ?? i.symbol.replace(/USDT$/, ''))),
    stockSymbols: list.filter((i) => i.assetClass === 'stock' || i.assetClass === 'etf').filter((i) => !i.providerSymbol?.includes('.')).map((i) => i.symbol),
  };
}
