import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indicators as I,
  settleDecision,
  computeStats,
  evaluateRisk,
  DEFAULT_RISK,
  simulatePortfolio,
  technicalSnapshot,
  validateDecisionInput,
  extractJson,
  syntheticCandles,
  type Candle,
  type Decision,
} from '../src/index.ts';

const H = 3_600_000;
const bar = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c, v: 100 });

const baseDecision = (over: Partial<Decision> = {}): Decision => ({
  id: 'd1',
  agentId: 'a',
  instrumentId: 'crypto:BTCUSDT',
  timeframe: '1h',
  action: 'buy',
  confidence: 0.7,
  horizonBars: 3,
  rationale: 'test',
  createdAt: 10 * H + 1, // mid-bar: bar at 10h must NOT be used
  ...over,
});

test('sma/ema/rsi basic values', () => {
  assert.deepEqual(I.sma([1, 2, 3, 4], 2).slice(1), [1.5, 2.5, 3.5]);
  const e = I.ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[2], 2);
  assert.equal(e[3], 3);
  const up = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.equal(I.last(I.rsi(up)), 100);
  const flat = new Array(30).fill(5);
  assert.equal(I.last(I.rsi(flat)), 50);
});

test('RSI matches Wilder reference within tolerance', () => {
  // Classic Wilder example series (closing prices), RSI(14) at bar 15 ≈ 70.53
  const px = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const r = I.rsi(px, 14);
  assert.ok(Math.abs(r[14] - 70.53) < 0.1, `got ${r[14]}`);
});

test('ATR, bollinger, supertrend, adx produce finite tails', () => {
  const c = syntheticCandles({ n: 300, timeframe: '1h', start: 0, seed: 7 });
  for (const v of [I.last(I.atr(c)), I.last(I.bollinger(I.closes(c)).upper), I.last(I.supertrend(c).direction), I.last(I.adx(c).adx), I.last(I.mfi(c)), I.last(I.cci(c))]) {
    assert.ok(Number.isFinite(v));
  }
  const snap = technicalSnapshot(c, '1h');
  assert.ok(snap && snap.trend.score >= -3 && snap.trend.score <= 3);
});

test('forward test: no look-ahead — enters at open of first bar after decision', () => {
  const c = [bar(10 * H, 100, 200, 50, 100), bar(11 * H, 101, 102, 100, 101.5), bar(12 * H, 101.5, 103, 101, 102), bar(13 * H, 102, 104, 101, 103)];
  const r = settleDecision(baseDecision(), c, { feeBps: 0, slippageBps: 0 });
  assert.equal(r.entryTime, 11 * H);
  assert.equal(r.entryPrice, 101);
  assert.equal(r.status, 'expired');
  assert.equal(r.exitPrice, 103);
  assert.ok(Math.abs(r.returnPct - (103 / 101 - 1)) < 1e-12);
});

test('forward test: stop beats target in the same bar (conservative)', () => {
  const c = [bar(11 * H, 100, 110, 90, 100)];
  const r = settleDecision(baseDecision({ stopLoss: 95, takeProfit: 105, horizonBars: 5 }), c, { feeBps: 0, slippageBps: 0 });
  assert.equal(r.exitReason, 'stop');
  assert.ok(Math.abs(r.returnPct - -0.05) < 1e-12);
  assert.ok(Math.abs((r.rMultiple ?? 0) - -1) < 1e-9);
});

test('forward test: short hits target; gap fills at open', () => {
  const c = [bar(11 * H, 100, 101, 99, 99.5), bar(12 * H, 90, 91, 89, 90)];
  const r = settleDecision(baseDecision({ action: 'sell', takeProfit: 95, stopLoss: 105, horizonBars: 5 }), c, { feeBps: 0, slippageBps: 0 });
  assert.equal(r.exitReason, 'target');
  assert.equal(r.exitPrice, 90); // gapped through 95 → better fill at open
  assert.ok(r.returnPct > 0.09);
});

test('forward test: limit not filled, open trade marked to market, hold scored', () => {
  const c = [bar(11 * H, 100, 101, 99, 100), bar(12 * H, 100, 101, 99, 100)];
  const nf = settleDecision(baseDecision({ entryPrice: 90, horizonBars: 2 }), c);
  assert.equal(nf.status, 'not_filled');
  const open = settleDecision(baseDecision({ horizonBars: 10 }), c, { feeBps: 0, slippageBps: 0 });
  assert.equal(open.status, 'open');
  assert.equal(open.directionCorrect, null);
  const hold = settleDecision(baseDecision({ action: 'hold', horizonBars: 2, priceAtDecision: 100 }), c);
  assert.equal(hold.status, 'closed');
  assert.equal(hold.directionCorrect, true);
});

test('fees and slippage reduce returns', () => {
  const c = [bar(11 * H, 100, 100, 100, 100)];
  const r = settleDecision(baseDecision({ horizonBars: 1 }), c, { feeBps: 10, slippageBps: 5 });
  assert.ok(r.returnPct < -0.002 && r.returnPct > -0.0031);
});

test('stats + calibration + portfolio', () => {
  const mk = (id: string, ret: number, conf: number, t: number) => ({
    decision: baseDecision({ id, confidence: conf, stopLoss: 95, priceAtDecision: 100 }),
    result: {
      decisionId: id, status: 'closed' as const, side: 'long' as const, exitReason: 'target' as const,
      returnPct: ret, rMultiple: ret / 0.05, mfePct: 0, maePct: 0, barsHeld: 1,
      horizonMovePct: ret, directionCorrect: ret > 0, updatedAt: 0, entryTime: t, exitTime: t + H,
    },
  });
  const items = [mk('a', 0.05, 0.9, 0), mk('b', -0.02, 0.6, 2 * H), mk('c', 0.03, 0.8, 4 * H)];
  const s = computeStats(items);
  assert.equal(s.trades, 3);
  assert.ok(Math.abs((s.winRate ?? 0) - 2 / 3) < 1e-9);
  assert.ok(Math.abs((s.profitFactor ?? 0) - 4) < 1e-9);
  assert.equal(s.calibration.find((b) => b.from === 0.9)?.hitRate, 1);
  const p = simulatePortfolio(items.map((x) => ({ ...x, assetClass: 'crypto' as const })));
  assert.equal(p.trades.length, 3);
  assert.ok(p.equity > 10_000);
});

test('risk engine sizes from stop and enforces limits', () => {
  const state = { equity: 10_000, peakEquity: 10_000, dayStartEquity: 10_000, open: [] };
  const v = evaluateRisk({ action: 'buy', confidence: 0.8, stopLoss: 95, priceAtDecision: 100, instrumentId: 'x' }, 'stock', state);
  assert.ok(v.approved);
  assert.equal(v.sizePct, 0.2); // 1% risk / 5% stop = 20% = cap
  const tight = evaluateRisk({ action: 'buy', confidence: 0.8, stopLoss: 80, priceAtDecision: 100, instrumentId: 'x' }, 'stock', state);
  assert.equal(tight.sizePct, 0.05);
  assert.equal(evaluateRisk({ action: 'buy', confidence: 0.8, priceAtDecision: 100, instrumentId: 'x' }, 'stock', state).approved, false);
  assert.equal(evaluateRisk({ action: 'buy', confidence: 0.3, stopLoss: 95, priceAtDecision: 100, instrumentId: 'x' }, 'stock', state).approved, false);
  const killed = evaluateRisk({ action: 'buy', confidence: 0.9, stopLoss: 95, priceAtDecision: 100, instrumentId: 'x' }, 'stock', state, { ...DEFAULT_RISK, killSwitch: true });
  assert.equal(killed.approved, false);
});

test('decision validation and JSON extraction', () => {
  const j = extractJson('Here you go:\n```json\n{"decisions":[{"instrumentId":"crypto:BTCUSDT","timeframe":"4h","action":"BUY","confidence":0.66,"stopLoss":"60000","rationale":"breakout with volume"}]}\n```');
  const d = (j as { decisions: unknown[] }).decisions[0];
  const v = validateDecisionInput(d);
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.value.action, 'buy');
    assert.equal(v.value.stopLoss, 60000);
  }
  const bad = validateDecisionInput({ action: 'moon', confidence: 2 });
  assert.equal(bad.ok, false);
});
