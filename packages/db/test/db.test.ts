import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/index.ts';
import { settleDecision, syntheticCandles } from '@tivaro/core';

test('store round-trips instruments, candles, decisions and results', () => {
  const s = new Store(':memory:');
  s.upsertInstrument({ id: 'crypto:BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin', assetClass: 'crypto', provider: 'binance', tags: ['BTC'] });
  const c = syntheticCandles({ n: 50, timeframe: '1h', start: 0, seed: 1 });
  s.upsertCandles('crypto:BTCUSDT', '1h', c);
  s.upsertCandles('crypto:BTCUSDT', '1h', c.slice(-5)); // idempotent
  assert.equal(s.candles('crypto:BTCUSDT', '1h', { limit: 1000 }).length, 50);
  assert.equal(s.lastCandleTime('crypto:BTCUSDT', '1h'), c[49].t);

  const d = {
    id: 'x1', agentId: 'claude', instrumentId: 'crypto:BTCUSDT', timeframe: '1h' as const, action: 'buy' as const, confidence: 0.7,
    horizonBars: 5, rationale: 'unit test', createdAt: c[10].t, evidence: ['rsi'], risk: { approved: true, sizePct: 0.1, reasons: [] },
  };
  s.insertDecision(d);
  assert.equal(s.decisions({ unsettledOnly: true }).length, 1);
  const r = settleDecision(d, s.candles('crypto:BTCUSDT', '1h'));
  s.saveResult(r);
  assert.equal(s.decisions({ unsettledOnly: true }).length, 0);
  const sc = s.scored();
  assert.equal(sc[0].assetClass, 'crypto');
  assert.equal(sc[0].decision.risk?.sizePct, 0.1);
  assert.equal(sc[0].result.status, 'expired');

  s.upsertOnchain([{ ts: 1, key: 'btc.x', value: 1, source: 't' }, { ts: 2, key: 'btc.x', value: 3, source: 't' }]);
  assert.equal(s.onchainLatest('btc.')[0].value, 3);
  s.setSetting('risk', { a: 1 });
  assert.deepEqual(s.getSetting('risk', {}), { a: 1 });
  s.close();
});
