/** Performance statistics for forward-tested decisions (per agent, timeframe, market…). */
import type { Decision, DecisionResult } from './types.ts';

export interface Scored {
  decision: Decision;
  result: DecisionResult;
}

export interface CalibrationBucket {
  from: number;
  to: number;
  n: number;
  hitRate: number | null;
}

export interface PerformanceStats {
  decisions: number;
  trades: number;
  openTrades: number;
  holds: number;
  winRate: number | null;
  avgReturnPct: number | null;
  /** Sum of per-trade returns (fraction). */
  sumReturnPct: number;
  /** Compounded return if each trade used its sizePct (default 10%) of equity sequentially. */
  compoundedReturnPct: number;
  profitFactor: number | null;
  avgR: number | null;
  expectancyPct: number | null;
  /** mean/std of per-trade returns × √n — rough, not annualised. */
  tradeSharpe: number | null;
  maxDrawdownPct: number;
  /** Share of resolved calls whose direction matched the move over the horizon. */
  directionalAccuracy: number | null;
  holdAccuracy: number | null;
  calibration: CalibrationBucket[];
  best: { decisionId: string; returnPct: number } | null;
  worst: { decisionId: string; returnPct: number } | null;
}

const TRADE_FINAL = new Set(['closed', 'expired']);

export function computeStats(items: Scored[], defaultSize = 0.1): PerformanceStats {
  const trades = items.filter((x) => x.result.side !== 'flat' && TRADE_FINAL.has(x.result.status));
  const open = items.filter((x) => x.result.status === 'open');
  const holds = items.filter((x) => x.result.side === 'flat');
  const rets = trades.map((x) => x.result.returnPct);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
  const sd =
    rets.length > 1 && mean !== null ? Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) : null;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const rs = trades.map((x) => x.result.rMultiple).filter((r): r is number => r !== null);

  // Equity curve by exit time.
  const ordered = [...trades].sort((a, b) => (a.result.exitTime ?? 0) - (b.result.exitTime ?? 0));
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  for (const t of ordered) {
    const size = clamp(t.decision.sizePct ?? defaultSize, 0, 1);
    eq *= 1 + t.result.returnPct * size;
    peak = Math.max(peak, eq);
    mdd = Math.min(mdd, eq / peak - 1);
  }

  const resolved = items.filter((x) => x.result.directionCorrect !== null);
  const dirCalls = resolved.filter((x) => x.result.side !== 'flat');
  const holdCalls = resolved.filter((x) => x.result.side === 'flat');

  const edges = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const calibration: CalibrationBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const b = resolved.filter((x) => x.decision.confidence >= edges[i] && x.decision.confidence < edges[i + 1]);
    calibration.push({
      from: edges[i],
      to: Math.min(1, edges[i + 1]),
      n: b.length,
      hitRate: b.length ? b.filter((x) => x.result.directionCorrect).length / b.length : null,
    });
  }

  const sorted = [...trades].sort((a, b) => a.result.returnPct - b.result.returnPct);
  return {
    decisions: items.length,
    trades: trades.length,
    openTrades: open.length,
    holds: holds.length,
    winRate: rets.length ? wins.length / rets.length : null,
    avgReturnPct: mean,
    sumReturnPct: rets.reduce((a, b) => a + b, 0),
    compoundedReturnPct: eq - 1,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    expectancyPct: mean,
    tradeSharpe: sd && mean !== null && sd > 0 ? (mean / sd) * Math.sqrt(rets.length) : null,
    maxDrawdownPct: mdd,
    directionalAccuracy: dirCalls.length ? dirCalls.filter((x) => x.result.directionCorrect).length / dirCalls.length : null,
    holdAccuracy: holdCalls.length ? holdCalls.filter((x) => x.result.directionCorrect).length / holdCalls.length : null,
    calibration,
    best: sorted.length ? { decisionId: sorted[sorted.length - 1].decision.id, returnPct: sorted[sorted.length - 1].result.returnPct } : null,
    worst: sorted.length ? { decisionId: sorted[0].decision.id, returnPct: sorted[0].result.returnPct } : null,
  };
}

export function groupStats<T extends Scored, K extends string>(items: T[], key: (x: T) => K): Record<K, PerformanceStats> {
  const groups = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const out = {} as Record<K, PerformanceStats>;
  for (const [k, v] of groups) out[k] = computeStats(v);
  return out;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
