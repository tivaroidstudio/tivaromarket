import { computeStats, simulatePortfolio, type PerformanceStats } from '@tivaro/core';
import type { Store } from '@tivaro/db';
import { riskConfig } from '@tivaro/agents';

export interface LeaderRow {
  agentId: string;
  name: string;
  provider: string;
  model: string;
  stats: PerformanceStats;
  portfolio: { equity: number; returnPct: number; maxDrawdownPct: number; openTrades: number; rejected: number };
}

export function leaderboard(store: Store, opts: { since?: number; mode?: 'live' | 'replay' } = {}): LeaderRow[] {
  const initial = store.getSetting<number>('paper.initialEquity', 10_000);
  const risk = riskConfig(store);
  return store
    .agents()
    .map((a) => {
      const items = store.scored({ agentId: a.id, since: opts.since, mode: opts.mode ?? 'live' });
      const sim = simulatePortfolio(items, { initialEquity: initial, risk });
      return {
        agentId: a.id,
        name: a.name,
        provider: a.provider,
        model: a.model,
        stats: computeStats(items),
        portfolio: {
          equity: sim.equity,
          returnPct: sim.returnPct,
          maxDrawdownPct: sim.maxDrawdownPct,
          openTrades: sim.trades.filter((t) => t.status === 'open').length,
          rejected: sim.rejected.length,
        },
      };
    })
    .sort((a, b) => b.portfolio.returnPct - a.portfolio.returnPct);
}

export function dailyReport(store: Store, now: number) {
  const d30 = now - 30 * 86_400_000;
  return {
    at: now,
    allTime: leaderboard(store).map(slim),
    last30d: leaderboard(store, { since: d30 }).map(slim),
  };
}

const slim = (r: LeaderRow) => ({
  agentId: r.agentId,
  returnPct: r.portfolio.returnPct,
  maxDrawdownPct: r.portfolio.maxDrawdownPct,
  trades: r.stats.trades,
  winRate: r.stats.winRate,
  profitFactor: r.stats.profitFactor,
  directionalAccuracy: r.stats.directionalAccuracy,
});
