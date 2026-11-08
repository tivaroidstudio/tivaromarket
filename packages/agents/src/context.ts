/**
 * Builds the research brief an agent sees. Everything is computed from data that existed
 * at `now` — the same function is used live and in replays, so replays can't peek ahead.
 */
import {
  technicalSnapshot, computeStats, TIMEFRAME_MS, type Instrument, type Timeframe, type TechnicalSnapshot,
} from '@tivaro/core';
import type { Store } from '@tivaro/db';

export interface InstrumentBrief {
  id: string;
  symbol: string;
  name: string;
  assetClass: Instrument['assetClass'];
  venue?: string;
  lastPrice: number | null;
  technicals: Partial<Record<Timeframe, TechnicalSnapshot>>;
  fundamentals?: Record<string, number | string | null>;
  news: { id: string; ts: string; source: string; title: string }[];
  events: { id: string; ts: string; title: string; importance: number }[];
  whales?: { inflowUsdM: number; outflowUsdM: number; count: number };
  openDecisions: { id: string; action: string; timeframe: string; ageBars: number; returnPct: number | null }[];
}

export interface MarketBrief {
  now: string;
  timeframe: Timeframe;
  instruments: InstrumentBrief[];
  macroEvents: { id: string; ts: string; title: string; country?: string; importance: number; forecast?: unknown; previous?: unknown; actual?: unknown }[];
  marketNews: { id: string; ts: string; source: string; title: string }[];
  onchain: { key: string; value: number; change24h: number | null }[];
  trackRecord: {
    decisions: number;
    trades: number;
    winRate: number | null;
    avgReturnPct: number | null;
    directionalAccuracy: number | null;
    calibration: { bucket: string; n: number; hitRate: number | null }[];
    recentMistakes: { instrument: string; action: string; returnPct: number; rationale: string }[];
  };
}

/** Higher timeframe shown alongside the trading one for multi-timeframe context. */
export const HIGHER_TF: Record<Timeframe, Timeframe[]> = {
  '1m': ['15m', '1h'], '5m': ['1h', '4h'], '15m': ['1h', '4h'], '30m': ['4h', '1d'],
  '1h': ['4h', '1d'], '4h': ['1d', '1w'], '1d': ['1w'], '1w': [],
};

const iso = (t: number) => new Date(t).toISOString().slice(0, 16) + 'Z';

export function buildBrief(store: Store, opts: { instruments: Instrument[]; timeframe: Timeframe; now: number; agentId: string; mode?: 'live' | 'replay' }): MarketBrief {
  const { now, timeframe } = opts;
  const dayAgo = now - 86_400_000;
  const allNews = store.news({ since: now - 2 * 86_400_000, limit: 400 }).filter((n) => n.ts <= now);
  const events = store.events({ from: now - 12 * 3_600_000, to: now + 4 * 86_400_000, minImportance: 2, limit: 300 });
  const whales = store.whales({ since: dayAgo, limit: 2000 }).filter((w) => w.ts <= now);
  const open = store
    .scored({ agentId: opts.agentId, since: now - 60 * 86_400_000, mode: opts.mode ?? 'live' })
    .filter(
      (x) =>
        x.result.side !== 'flat' &&
        x.decision.createdAt <= now &&
        (x.result.status === 'open' || x.result.status === 'pending' || (x.result.exitTime !== undefined && x.result.exitTime > now)),
    );

  const instruments: InstrumentBrief[] = opts.instruments.map((inst) => {
    const technicals: InstrumentBrief['technicals'] = {};
    let lastPrice: number | null = null;
    for (const tf of [timeframe, ...HIGHER_TF[timeframe]]) {
      const c = store.candles(inst.id, tf, { to: now - TIMEFRAME_MS[tf], limit: 400 }); // closed bars only
      const s = technicalSnapshot(c, tf);
      if (s) technicals[tf] = s;
      if (tf === timeframe && c.length) lastPrice = c[c.length - 1].c;
    }
    const tags = [inst.symbol, ...(inst.tags ?? []), inst.name.split(' ')[0]].map((t) => t.toLowerCase());
    const news = allNews
      .filter((n) => n.symbols?.some((s) => tags.includes(s.toLowerCase())) || tags.some((t) => t.length > 2 && n.title.toLowerCase().includes(t)))
      .slice(0, 8)
      .map((n) => ({ id: n.id, ts: iso(n.ts), source: n.source, title: n.title }));
    const ev = events.filter((e) => e.symbol && tags.includes(e.symbol.toLowerCase())).map((e) => ({ id: e.id, ts: iso(e.ts), title: e.title, importance: e.importance }));
    const base = (inst.tags?.[0] ?? inst.symbol).toUpperCase();
    const w = inst.assetClass === 'crypto' ? whales.filter((x) => x.symbol === base) : [];
    const fund = store.fundamentals(inst.id)[0]?.data;
    return {
      id: inst.id,
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      venue: inst.venue,
      lastPrice,
      technicals,
      fundamentals: fund,
      news,
      events: ev,
      whales: w.length
        ? {
            inflowUsdM: round(w.filter((x) => x.flow === 'exchange_inflow').reduce((a, x) => a + x.amountUsd, 0) / 1e6),
            outflowUsdM: round(w.filter((x) => x.flow === 'exchange_outflow').reduce((a, x) => a + x.amountUsd, 0) / 1e6),
            count: w.length,
          }
        : undefined,
      openDecisions: open
        .filter((x) => x.decision.instrumentId === inst.id)
        .map((x) => ({
          id: x.decision.id,
          action: x.decision.action,
          timeframe: x.decision.timeframe,
          ageBars: Math.floor((now - x.decision.createdAt) / TIMEFRAME_MS[x.decision.timeframe]),
          returnPct: x.result.status === 'open' ? round(x.result.returnPct * 100) : null,
        })),
    };
  });

  const usedNews = new Set(instruments.flatMap((i) => i.news.map((n) => n.id)));
  const marketNews = allNews.filter((n) => n.ts > dayAgo && !usedNews.has(n.id)).slice(0, 25).map((n) => ({ id: n.id, ts: iso(n.ts), source: n.source, title: n.title }));
  const macroEvents = events
    .filter((e) => e.kind !== 'earnings')
    .filter((e) => e.importance >= 3 || e.kind === 'central_bank')
    .slice(0, 30)
    .map((e) => ({ id: e.id, ts: iso(e.ts), title: e.title, country: e.country, importance: e.importance, forecast: e.forecast, previous: e.previous, actual: e.actual }));
  const onchain = store
    .onchainLatest()
    .filter((m) => m.ts <= now)
    .map((m) => ({ key: m.key, value: round(m.value), change24h: m.prev24h !== undefined && m.prev24h !== 0 ? round(((m.value - m.prev24h) / Math.abs(m.prev24h)) * 100) : null }));

  const history = store
    .scored({ agentId: opts.agentId, since: now - 90 * 86_400_000, mode: opts.mode ?? 'live' })
    .filter((x) => x.decision.createdAt < now && (x.result.exitTime ?? Infinity) <= now);
  const stats = computeStats(history);
  const mistakes = history
    .filter((x) => (x.result.status === 'closed' || x.result.status === 'expired') && x.result.returnPct < 0)
    .sort((a, b) => a.result.returnPct - b.result.returnPct)
    .slice(0, 5)
    .map((x) => ({ instrument: x.decision.instrumentId, action: x.decision.action, returnPct: round(x.result.returnPct * 100), rationale: x.decision.rationale.slice(0, 160) }));

  return {
    now: iso(now),
    timeframe,
    instruments,
    macroEvents,
    marketNews,
    onchain,
    trackRecord: {
      decisions: stats.decisions,
      trades: stats.trades,
      winRate: stats.winRate === null ? null : round(stats.winRate),
      avgReturnPct: stats.avgReturnPct === null ? null : round(stats.avgReturnPct * 100),
      directionalAccuracy: stats.directionalAccuracy === null ? null : round(stats.directionalAccuracy),
      calibration: stats.calibration.filter((b) => b.n > 0).map((b) => ({ bucket: `${b.from}-${b.to}`, n: b.n, hitRate: b.hitRate === null ? null : round(b.hitRate) })),
      recentMistakes: mistakes,
    },
  };
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
