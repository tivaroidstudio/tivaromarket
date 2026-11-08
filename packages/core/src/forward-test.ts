/**
 * Forward test ("backtest on future data"): every recorded decision is settled only on
 * candles that OPEN at or after the decision timestamp. The bar that was in progress when
 * the agent decided is never used, so there is no look-ahead. Settlement is pure and
 * idempotent — the worker simply re-runs it whenever new candles arrive (each interval
 * and in the daily job) and stores the latest result.
 */
import type { Candle, Decision, DecisionResult, ExitReason } from './types.ts';

export interface SettleOptions {
  /** Commission per side in basis points (10 = 0.10%). */
  feeBps?: number;
  /** Adverse slippage per fill in basis points. */
  slippageBps?: number;
  /** |move| below this counts a "hold" as correct. Fraction (0.005 = 0.5%). */
  holdBandPct?: number;
  now?: number;
}

const DEFAULTS = { feeBps: 5, slippageBps: 2, holdBandPct: 0.005 };

export function sideOf(d: Pick<Decision, 'action'>): 'long' | 'short' | 'flat' {
  return d.action === 'buy' ? 'long' : d.action === 'sell' ? 'short' : 'flat';
}

export function settleDecision(d: Decision, candles: Candle[], opts: SettleOptions = {}): DecisionResult {
  const o = { ...DEFAULTS, ...opts };
  const now = o.now ?? Date.now();
  const side = sideOf(d);
  const fwd = candles.filter((c) => c.t >= d.createdAt).sort((a, b) => a.t - b.t);
  const horizon = Math.max(1, Math.floor(d.horizonBars));
  const window = fwd.slice(0, horizon);
  const horizonDone = fwd.length >= horizon;

  const base: DecisionResult = {
    decisionId: d.id,
    status: 'pending',
    side,
    exitReason: null,
    returnPct: 0,
    rMultiple: null,
    mfePct: 0,
    maePct: 0,
    barsHeld: 0,
    horizonMovePct: null,
    directionCorrect: null,
    updatedAt: now,
  };

  if (window.length === 0) return base;

  const ref = d.priceAtDecision && d.priceAtDecision > 0 ? d.priceAtDecision : window[0].o;
  const lastBar = window[window.length - 1];
  const move = (lastBar.c - ref) / ref;
  if (horizonDone) {
    base.horizonMovePct = move;
    base.directionCorrect =
      side === 'long' ? move > 0 : side === 'short' ? move < 0 : Math.abs(move) <= o.holdBandPct;
  }

  if (side === 'flat') {
    base.status = horizonDone ? 'closed' : 'pending';
    base.barsHeld = window.length;
    return base;
  }

  const dir = side === 'long' ? 1 : -1;
  const slip = o.slippageBps / 10_000;
  const fee = o.feeBps / 10_000;

  // ---- entry ----
  let entryIdx = -1;
  let entryRaw = 0;
  if (d.entryPrice && d.entryPrice > 0) {
    const lim = d.entryPrice;
    for (let i = 0; i < window.length; i++) {
      const b = window[i];
      if (dir === 1 && b.l <= lim) {
        entryIdx = i;
        entryRaw = Math.min(b.o, lim);
        break;
      }
      if (dir === -1 && b.h >= lim) {
        entryIdx = i;
        entryRaw = Math.max(b.o, lim);
        break;
      }
    }
    if (entryIdx < 0) {
      base.status = horizonDone ? 'not_filled' : 'pending';
      return base;
    }
  } else {
    entryIdx = 0;
    entryRaw = window[0].o;
  }
  const entry = entryRaw * (1 + dir * slip);

  // Validate protective levels against the actual entry; ignore ones on the wrong side.
  const sl = d.stopLoss && (dir === 1 ? d.stopLoss < entry : d.stopLoss > entry) ? d.stopLoss : undefined;
  const tp = d.takeProfit && (dir === 1 ? d.takeProfit > entry : d.takeProfit < entry) ? d.takeProfit : undefined;

  let exitRaw: number | undefined;
  let exitIdx = -1;
  let reason: ExitReason = null;
  let mfe = 0;
  let mae = 0;

  for (let i = entryIdx; i < window.length; i++) {
    const b = window[i];
    const fav = dir === 1 ? (b.h - entry) / entry : (entry - b.l) / entry;
    const adv = dir === 1 ? (b.l - entry) / entry : (entry - b.h) / entry;
    // Gap handling: if the bar opens beyond a level, fill at the open.
    const hitSL = sl !== undefined && (dir === 1 ? b.l <= sl : b.h >= sl);
    const hitTP = tp !== undefined && (dir === 1 ? b.h >= tp : b.l <= tp);
    if (hitSL) {
      // Conservative: if both are touched inside one bar, assume the stop came first.
      exitRaw = dir === 1 ? Math.min(i === entryIdx ? sl! : b.o, sl!) : Math.max(i === entryIdx ? sl! : b.o, sl!);
      reason = 'stop';
      mae = Math.min(mae, dir === 1 ? (exitRaw - entry) / entry : (entry - exitRaw) / entry);
      mfe = Math.max(mfe, i === entryIdx ? 0 : fav);
      exitIdx = i;
      break;
    }
    if (hitTP) {
      exitRaw = dir === 1 ? Math.max(i === entryIdx ? tp! : b.o, tp!) : Math.min(i === entryIdx ? tp! : b.o, tp!);
      reason = 'target';
      mfe = Math.max(mfe, dir === 1 ? (exitRaw - entry) / entry : (entry - exitRaw) / entry);
      mae = Math.min(mae, adv);
      exitIdx = i;
      break;
    }
    mfe = Math.max(mfe, fav);
    mae = Math.min(mae, adv);
  }

  if (exitIdx < 0 && horizonDone) {
    exitIdx = window.length - 1;
    exitRaw = window[exitIdx].c;
    reason = 'horizon';
  }

  const riskPct = sl !== undefined ? Math.abs(entry - sl) / entry : null;
  base.entryTime = window[entryIdx].t;
  base.entryPrice = entry;
  base.mfePct = mfe;
  base.maePct = mae;

  if (exitIdx >= 0 && exitRaw !== undefined) {
    const exit = exitRaw * (1 - dir * slip);
    const ret = dir * (exit / entry - 1) - 2 * fee;
    base.status = reason === 'horizon' ? 'expired' : 'closed';
    base.exitTime = window[exitIdx].t;
    base.exitPrice = exit;
    base.exitReason = reason;
    base.returnPct = ret;
    base.barsHeld = exitIdx - entryIdx + 1;
  } else {
    // Still open: mark to market on the latest close.
    const mark = window[window.length - 1].c;
    base.status = 'open';
    base.returnPct = dir * (mark / entry - 1) - fee;
    base.barsHeld = window.length - entryIdx;
  }
  base.rMultiple = riskPct ? base.returnPct / riskPct : null;
  return base;
}

/** Settle many decisions against a candle lookup. */
export function settleAll(
  decisions: Decision[],
  getCandles: (d: Decision) => Candle[],
  opts: SettleOptions = {},
): DecisionResult[] {
  return decisions.map((d) => settleDecision(d, getCandles(d), opts));
}

export const isFinal = (r: Pick<DecisionResult, 'status'>) =>
  r.status === 'closed' || r.status === 'expired' || r.status === 'not_filled' || r.status === 'skipped';
