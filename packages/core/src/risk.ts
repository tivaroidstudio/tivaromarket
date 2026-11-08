/**
 * Risk engine. AI agents propose; this layer disposes. Every decision passes through
 * `evaluateRisk` before it reaches the paper portfolio (and, later, a real broker).
 */
import type { AssetClass, Decision } from './types.ts';

export interface RiskConfig {
  /** Max loss per trade if the stop is hit, as a fraction of equity (0.01 = 1%). */
  riskPerTradePct: number;
  /** Hard cap for one position's notional, fraction of equity. */
  maxPositionPct: number;
  maxOpenPositions: number;
  /** Sum of |notional| / equity. */
  maxGrossExposurePct: number;
  /** Stop opening new trades after this drawdown within a UTC day. */
  maxDailyLossPct: number;
  /** Stop everything after this peak-to-trough drawdown. */
  maxDrawdownPct: number;
  requireStopLoss: boolean;
  minConfidence: number;
  allowShort: boolean;
  /** Per-class exposure caps, fraction of equity. */
  maxClassExposurePct: Partial<Record<AssetClass, number>>;
  /** Manual kill switch: blocks all new entries. */
  killSwitch: boolean;
}

export const DEFAULT_RISK: RiskConfig = {
  riskPerTradePct: 0.01,
  maxPositionPct: 0.2,
  maxOpenPositions: 12,
  maxGrossExposurePct: 1.5,
  maxDailyLossPct: 0.04,
  maxDrawdownPct: 0.25,
  requireStopLoss: true,
  minConfidence: 0.55,
  allowShort: true,
  maxClassExposurePct: { crypto: 0.6, forex: 1.0, commodity: 0.5, stock: 1.0, etf: 1.0, index: 1.0 },
  killSwitch: false,
};

export interface OpenPositionLite {
  instrumentId: string;
  assetClass: AssetClass;
  notionalPct: number;
}

export interface RiskState {
  equity: number;
  peakEquity: number;
  dayStartEquity: number;
  open: OpenPositionLite[];
}

export interface RiskVerdict {
  approved: boolean;
  /** Final notional as a fraction of equity. */
  sizePct: number;
  reasons: string[];
}

export function evaluateRisk(
  d: Pick<Decision, 'action' | 'confidence' | 'stopLoss' | 'sizePct' | 'instrumentId' | 'priceAtDecision' | 'entryPrice'>,
  assetClass: AssetClass,
  state: RiskState,
  cfg: RiskConfig = DEFAULT_RISK,
): RiskVerdict {
  const reasons: string[] = [];
  if (d.action === 'hold' || d.action === 'close') return { approved: true, sizePct: 0, reasons: ['no new exposure'] };
  if (cfg.killSwitch) reasons.push('kill switch is on');
  if (d.action === 'sell' && !cfg.allowShort) reasons.push('shorting disabled');
  if (d.confidence < cfg.minConfidence) reasons.push(`confidence ${d.confidence} < min ${cfg.minConfidence}`);
  if (state.equity <= state.dayStartEquity * (1 - cfg.maxDailyLossPct)) reasons.push('daily loss limit reached');
  if (state.equity <= state.peakEquity * (1 - cfg.maxDrawdownPct)) reasons.push('max drawdown reached');
  if (state.open.length >= cfg.maxOpenPositions) reasons.push('too many open positions');
  if (state.open.some((p) => p.instrumentId === d.instrumentId)) reasons.push('position already open on this instrument');

  const price = d.entryPrice ?? d.priceAtDecision;
  let size = cfg.maxPositionPct;
  if (d.stopLoss && price) {
    const stopDist = Math.abs(price - d.stopLoss) / price;
    if (stopDist > 0) size = Math.min(size, cfg.riskPerTradePct / stopDist);
  } else if (cfg.requireStopLoss) {
    reasons.push('stop loss required');
  }
  if (d.sizePct !== undefined && d.sizePct > 0) size = Math.min(size, d.sizePct);

  const gross = state.open.reduce((a, p) => a + Math.abs(p.notionalPct), 0);
  size = Math.min(size, Math.max(0, cfg.maxGrossExposurePct - gross));
  const classCap = cfg.maxClassExposurePct[assetClass];
  if (classCap !== undefined) {
    const used = state.open.filter((p) => p.assetClass === assetClass).reduce((a, p) => a + Math.abs(p.notionalPct), 0);
    size = Math.min(size, Math.max(0, classCap - used));
  }
  if (size <= 0.0005) reasons.push('no exposure budget left');

  return { approved: reasons.length === 0, sizePct: reasons.length ? 0 : round4(size), reasons };
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
