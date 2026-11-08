import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '@tivaro/db';
import { syntheticCandles, type Instrument } from '@tivaro/core';
import { runAgent, buildBrief, type LlmProvider } from '../src/index.ts';

const H = 3_600_000;
const inst: Instrument = { id: 'crypto:BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin', assetClass: 'crypto', provider: 'synthetic', tags: ['BTC'] };

function setup() {
  const s = new Store(':memory:');
  s.upsertInstrument(inst);
  const start = Date.UTC(2026, 0, 1);
  s.upsertCandles(inst.id, '1h', syntheticCandles({ n: 600, timeframe: '1h', start, seed: 3, drift: 0.0005 }));
  s.upsertCandles(inst.id, '4h', syntheticCandles({ n: 150, timeframe: '4h', start, seed: 4 }));
  s.upsertCandles(inst.id, '1d', syntheticCandles({ n: 40, timeframe: '1d', start, seed: 5 }));
  s.upsertNews([{ id: 'n1', ts: start + 490 * H, source: 'T', title: 'Bitcoin ETF inflows surge', symbols: ['BTC'] }, { id: 'n2', ts: start + 700 * H, source: 'T', title: 'Future Bitcoin news' }]);
  return { s, now: start + 500 * H };
}

test('brief never contains data from after `now`', () => {
  const { s, now } = setup();
  const b = buildBrief(s, { instruments: [inst], timeframe: '1h', now, agentId: 'x' });
  const t = b.instruments[0].technicals['1h']!;
  assert.ok(t.lastTime + H <= now);
  assert.deepEqual(b.instruments[0].news.map((n) => n.id), ['n1']);
});

test('LLM agent run: parses, validates, risk-checks and stores', async () => {
  const { s, now } = setup();
  s.upsertAgent({ id: 'mock', name: 'Mock', provider: 'mock', model: 'm1', config: {}, enabled: true });
  let seenUser = '';
  const provider: LlmProvider = {
    id: 'mock', label: 'mock', requires: [], defaultModel: 'm1', supportsWebSearch: false,
    async complete(req) {
      seenUser = req.user;
      const price = JSON.parse(req.user.slice(req.user.indexOf('{'))).instruments[0].lastPrice;
      return {
        text: '```json\n' + JSON.stringify({
          marketView: 'test view',
          decisions: [
            { instrumentId: inst.id, action: 'buy', confidence: 0.72, stopLoss: price * 0.97, takeProfit: price * 1.06, horizonBars: 12, rationale: 'Wybicie z wolumenem', sources: ['n1'] },
            { instrumentId: 'stock:NOPE', action: 'buy', confidence: 0.9, rationale: 'out of scope' },
          ],
        }) + '\n```',
        inputTokens: 1000, outputTokens: 200,
      };
    },
  };
  const agent = s.agent('mock')!;
  const r = await runAgent({ store: s, agent, timeframe: '1h', instruments: [inst], env: {}, now, provider });
  assert.ok(seenUser.includes('trackRecord'));
  assert.equal(r.decisions.length, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.decisions[0].risk?.approved, true);
  assert.ok((r.decisions[0].risk?.sizePct ?? 0) > 0);
  assert.equal(s.runs()[0].status, 'ok');
  assert.equal(s.runs()[0].inputTokens, 1000);
});

test('baseline agent produces decisions for each instrument', async () => {
  const { s, now } = setup();
  s.upsertAgent({ id: 'baseline', name: 'Baseline', provider: 'baseline', model: 'rules-v1', config: {}, enabled: true });
  const r = await runAgent({ store: s, agent: s.agent('baseline')!, timeframe: '1h', instruments: [inst], env: {}, now });
  assert.equal(r.decisions.length, 1);
  assert.ok(['buy', 'sell', 'hold'].includes(r.decisions[0].action));
});
