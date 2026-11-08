/**
 * Paper portfolio simulation: "what if I had followed this agent with the risk rules".
 * Event-driven over entry/exit times of settled decisions; positions can overlap.
 */
import { evaluateRisk, DEFAULT_RISK, type RiskConfig, type OpenPositionLite } from './risk.ts';
import type { AssetClass, Decision, DecisionResult } from './types.ts';

export interface PortfolioTrade {
  decisionId: string;
  instrumentId: string;
  side: 'long' | 'short';
  sizePct: number;
  entryTime: number;
  exitTime?: number;
  returnPct: number;
  pnl: number;
  status: 'open' | 'closed';
}

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface PortfolioResult {
  initialEquity: number;
  equity: number;
  returnPct: number;
  maxDrawdownPct: number;
  trades: PortfolioTrade[];
  rejected: { decisionId: string; reasons: string[] }[];
  curve: EquityPoint[];
}

const DAY = 86_400_000;

export function simulatePortfolio(
  items: { decision: Decision; result: DecisionResult; assetClass: AssetClass }[],
  opts: { initialEquity?: number; risk?: RiskConfig } = {},
): PortfolioResult {
  const initial = opts.initialEquity ?? 10_000;
  const risk = opts.risk ?? DEFAULT_RISK;
  type Ev = { t: number; kind: 'exit' | 'entry'; idx: number };
  const evs: Ev[] = [];
  items.forEach((it, idx) => {
    if (it.result.side === 'flat' || it.result.entryTime === undefined) return;
    evs.push({ t: it.result.entryTime, kind: 'entry', idx });
    if (it.result.exitTime !== undefined) evs.push({ t: it.result.exitTime, kind: 'exit', idx });
  });
  // Exits before entries at equal timestamps frees budget.
  evs.sort((a, b) => a.t - b.t || (a.kind === b.kind ? 0 : a.kind === 'exit' ? -1 : 1));

  let equity = initial;
  let peak = initial;
  let mdd = 0;
  let day = -1;
  let dayStart = initial;
  const open = new Map<number, { pos: OpenPositionLite; trade: PortfolioTrade; equityAtEntry: number }>();
  const trades: PortfolioTrade[] = [];
  const rejected: PortfolioResult['rejected'] = [];
  const curve: EquityPoint[] = [{ t: evs[0]?.t ?? 0, equity }];

  for (const ev of evs) {
    const it = items[ev.idx];
    const dnum = Math.floor(ev.t / DAY);
    if (dnum !== day) {
      day = dnum;
      dayStart = equity;
    }
    if (ev.kind === 'entry') {
      const verdict = evaluateRisk(it.decision, it.assetClass, {
        equity,
        peakEquity: peak,
        dayStartEquity: dayStart,
        open: [...open.values()].map((o) => o.pos),
      }, risk);
      if (!verdict.approved) {
        rejected.push({ decisionId: it.decision.id, reasons: verdict.reasons });
        continue;
      }
      const trade: PortfolioTrade = {
        decisionId: it.decision.id,
        instrumentId: it.decision.instrumentId,
        side: it.result.side as 'long' | 'short',
        sizePct: verdict.sizePct,
        entryTime: ev.t,
        returnPct: it.result.returnPct,
        pnl: 0,
        status: 'open',
      };
      trades.push(trade);
      open.set(ev.idx, {
        pos: { instrumentId: it.decision.instrumentId, assetClass: it.assetClass, notionalPct: verdict.sizePct },
        trade,
        equityAtEntry: equity,
      });
    } else {
      const o = open.get(ev.idx);
      if (!o) continue;
      open.delete(ev.idx);
      o.trade.exitTime = ev.t;
      o.trade.status = 'closed';
      o.trade.pnl = o.equityAtEntry * o.trade.sizePct * it.result.returnPct;
      equity += o.trade.pnl;
      peak = Math.max(peak, equity);
      mdd = Math.min(mdd, equity / peak - 1);
      curve.push({ t: ev.t, equity });
    }
  }
  // Mark open trades to market (unrealised) for the headline number.
  let unrealised = 0;
  for (const o of open.values()) {
    o.trade.pnl = o.equityAtEntry * o.trade.sizePct * o.trade.returnPct;
    unrealised += o.trade.pnl;
  }
  const finalEq = equity + unrealised;
  return {
    initialEquity: initial,
    equity: finalEq,
    returnPct: finalEq / initial - 1,
    maxDrawdownPct: mdd,
    trades,
    rejected,
    curve,
  };
}
