/**
 * Offline end-to-end demo on SYNTHETIC data (no network, no keys):
 * seeds instruments with random-walk candles, replays the baseline agent, settles the
 * forward test and prints the leaderboard. Use it to see the whole pipeline work.
 *   node apps/worker/src/demo.ts [./data/demo.db]
 */
import { rmSync } from 'node:fs';
import { syntheticCandles, TIMEFRAME_MS, type Instrument } from '@tivaro/core';
import { Store } from '@tivaro/db';
import { resample } from '@tivaro/data';
import { replay } from './replay.ts';
import { leaderboard } from './report.ts';

const path = process.argv[2] ?? './data/demo.db';
if (path !== ':memory:') rmSync(path, { force: true });
const store = new Store(path);
const H = TIMEFRAME_MS['1h'];
const start = Date.UTC(2026, 0, 1);
const demo: Instrument[] = [
  { id: 'crypto:BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin (synthetic)', assetClass: 'crypto', provider: 'synthetic', tags: ['BTC'] },
  { id: 'crypto:ETHUSDT', symbol: 'ETHUSDT', name: 'Ethereum (synthetic)', assetClass: 'crypto', provider: 'synthetic', tags: ['ETH'] },
  { id: 'stock:NVDA', symbol: 'NVDA', name: 'NVIDIA (synthetic)', assetClass: 'stock', provider: 'synthetic' },
  { id: 'forex:EURUSD', symbol: 'EURUSD', name: 'EUR/USD (synthetic)', assetClass: 'forex', provider: 'synthetic' },
  { id: 'commodity:GOLD', symbol: 'GOLD', name: 'Gold (synthetic)', assetClass: 'commodity', provider: 'synthetic' },
];
demo.forEach((inst, k) => {
  store.upsertInstrument(inst);
  const h = syntheticCandles({ n: 24 * 120, timeframe: '1h', start, price: [60000, 3000, 120, 1.1, 2400][k], vol: [0.008, 0.01, 0.009, 0.0015, 0.004][k], drift: [0.0002, 0.0001, 0.0003, 0, 0.0001][k], seed: 11 + k });
  store.upsertCandles(inst.id, '1h', h);
  store.upsertCandles(inst.id, '4h', resample(h, '4h'));
  store.upsertCandles(inst.id, '1d', resample(h, '1d'));
});
store.upsertAgent({ id: 'baseline', name: 'Baseline (wskaźniki)', provider: 'baseline', model: 'rules-v1', config: {}, enabled: true });

const t0 = Date.now();
const r = await replay(store, {}, { agentId: 'baseline', timeframe: '4h', from: start + 40 * 86_400_000, to: start + 118 * 86_400_000 });
const lb = leaderboard(store, { mode: 'replay' })[0];
const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(2)}%`);
console.log(`Replay: ${r.steps} steps, ${r.decisions} decisions in ${Date.now() - t0} ms (errors: ${r.errors.length})`);
console.log(`Trades ${lb.stats.trades} | win rate ${pct(lb.stats.winRate)} | PF ${lb.stats.profitFactor?.toFixed(2) ?? '–'} | dir. accuracy ${pct(lb.stats.directionalAccuracy)}`);
console.log(`Paper portfolio ${pct(lb.portfolio.returnPct)} | max DD ${pct(lb.portfolio.maxDrawdownPct)} | rejected by risk ${lb.portfolio.rejected}`);
console.log('(synthetic random-walk data — numbers only prove the pipeline, not an edge)');
void H;
store.close();
