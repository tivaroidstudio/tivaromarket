/**
 * Rule-based baseline "agent". No AI, no cost. It exists so the AI agents always have a
 * benchmark in the forward-test leaderboard: if an LLM can't beat this, it has no edge.
 */
import type { DecisionInput } from '@tivaro/core';
import type { MarketBrief } from './context.ts';

export function baselineDecide(brief: MarketBrief): { marketView: string; decisions: DecisionInput[] } {
  const decisions: DecisionInput[] = [];
  for (const inst of brief.instruments) {
    const s = inst.technicals[brief.timeframe];
    if (!s || inst.lastPrice === null || !s.volatility.atr14) continue;
    const higher = Object.values(inst.technicals).find((x) => x && x.timeframe !== brief.timeframe);
    const atr = s.volatility.atr14;
    const rsi = s.momentum.rsi14 ?? 50;
    const strong = (s.trend.adx ?? 0) >= 20;
    const htfUp = !higher || higher.trend.score >= 0;
    const htfDown = !higher || higher.trend.score <= 0;
    const px = inst.lastPrice;
    const hasOpen = inst.openDecisions.length > 0;
    let action: DecisionInput['action'] = 'hold';
    if (!hasOpen && strong && s.trend.score >= 2 && s.trend.supertrend === 'up' && rsi < 70 && htfUp) action = 'buy';
    else if (!hasOpen && strong && s.trend.score <= -2 && s.trend.supertrend === 'down' && rsi > 30 && htfDown) action = 'sell';
    const dir = action === 'buy' ? 1 : action === 'sell' ? -1 : 0;
    decisions.push({
      instrumentId: inst.id,
      timeframe: brief.timeframe,
      action,
      confidence: dir ? 0.6 : 0.5,
      stopLoss: dir ? px - dir * 2 * atr : undefined,
      takeProfit: dir ? px + dir * 3 * atr : undefined,
      horizonBars: 20,
      rationale: dir
        ? `Trend-following: EMA stack ${s.trend.score > 0 ? 'wzrostowy' : 'spadkowy'}, Supertrend ${s.trend.supertrend}, ADX ${s.trend.adx}, RSI ${rsi}.`
        : 'Brak wyraźnego trendu zgodnego z wyższym interwałem — czekam.',
      evidence: s.signals.slice(0, 5),
    });
  }
  return { marketView: 'Baseline: trend-following na EMA20/50/200 + Supertrend + ADX, SL 2×ATR, TP 3×ATR.', decisions };
}
