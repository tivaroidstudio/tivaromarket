'use client';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useApi } from '@/lib/api';
import { ASSET_LABEL, dt, num, price, tone } from '@/lib/format';
import { Card, Empty, ErrorBox, PageHeader, Pills } from '@/components/ui';
import { PriceChart, type Candle, type Marker, type Overlay } from '@/components/PriceChart';
import { DecisionsTable, type DecisionRow } from '@/components/DecisionsTable';

const TFS = ['15m', '1h', '4h', '1d', '1w'] as const;

interface Ind {
  t: number[]; ema20: (number | null)[]; ema50: (number | null)[]; ema200: (number | null)[]; bbUpper: (number | null)[]; bbLower: (number | null)[];
  supertrend: (number | null)[];
  snapshot: null | {
    close: number; changePct: { bar: number; bars5: number; bars20: number };
    trend: { score: number; supertrend: string | null; adx: number | null; ema20: number; ema50: number; ema200: number | null };
    momentum: { rsi14: number | null; macdHist: number | null; stochK: number | null; cci20: number | null; mfi14: number | null };
    volatility: { atr14: number | null; atrPct: number | null; bbPercentB: number | null; squeeze: boolean };
    volume: { zScore: number | null };
    levels: { donchianHigh20: number | null; donchianLow20: number | null; pivot: { p: number; r1: number; s1: number } | null };
    signals: string[];
  };
}

export default function InstrumentPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = decodeURIComponent(raw);
  const [tf, setTf] = useState<(typeof TFS)[number]>('4h');
  const [layers, setLayers] = useState({ ema: true, bb: false, st: true });
  const inst = useApi<any[]>('/instruments').data?.find((i) => i.id === id);
  const candles = useApi<Candle[]>(`/candles?instrumentId=${encodeURIComponent(id)}&tf=${tf}&limit=400`, 60_000);
  const ind = useApi<Ind>(`/indicators?instrumentId=${encodeURIComponent(id)}&tf=${tf}&limit=400`, 60_000);
  const decisions = useApi<DecisionRow[]>(`/decisions?instrumentId=${encodeURIComponent(id)}&limit=100`, 60_000);
  const symbol = id.split(':')[1] ?? id;
  const news = useApi<any[]>(`/news?q=${encodeURIComponent(inst?.tags?.[0] ?? symbol.replace(/USDT$/, ''))}&limit=15`);
  const fundamentals = useApi<{ source: string; data: Record<string, number | string | null> }[]>(inst?.assetClass === 'stock' ? `/fundamentals/${encodeURIComponent(id)}` : null);

  const overlays = useMemo<Overlay[]>(() => {
    const d = ind.data;
    if (!d) return [];
    const o: Overlay[] = [];
    if (layers.ema) o.push({ name: 'EMA20', color: '#5b8cff', values: d.ema20, t: d.t }, { name: 'EMA50', color: '#f5b83d', values: d.ema50, t: d.t }, { name: 'EMA200', color: '#b07cff', values: d.ema200, t: d.t });
    if (layers.bb) o.push({ name: 'BB+', color: 'rgba(125,136,150,0.7)', values: d.bbUpper, t: d.t, dashed: true }, { name: 'BB-', color: 'rgba(125,136,150,0.7)', values: d.bbLower, t: d.t, dashed: true });
    if (layers.st) o.push({ name: 'Supertrend', color: '#1fc77e', values: d.supertrend, t: d.t });
    return o;
  }, [ind.data, layers]);

  const markers = useMemo<Marker[]>(
    () => (decisions.data ?? []).filter((r) => r.decision.timeframe === tf).map((r) => ({ t: r.decision.createdAt, side: r.decision.action as Marker['side'], text: r.decision.agentId })),
    [decisions.data, tf],
  );
  const s = ind.data?.snapshot;

  return (
    <>
      <PageHeader
        title={inst ? `${inst.symbol} · ${inst.name}` : symbol}
        subtitle={inst ? `${ASSET_LABEL[inst.assetClass]} · dane: ${inst.provider}${inst.venue === 'xtb-manual' ? ' · wykonanie ręczne w XTB' : ''}` : undefined}
        right={
          s && (
            <div className="text-right">
              <div className="num text-2xl font-semibold">{price(s.close)}</div>
              <div className={`num text-sm ${tone(s.changePct.bar)}`}>{num(s.changePct.bar)}% ostatnia świeca</div>
            </div>
          )
        }
      />
      <ErrorBox error={candles.error} />
      <div className="grid gap-4 xl:grid-cols-4">
        <Card
          className="xl:col-span-3"
          title={<Pills value={tf} onChange={setTf} options={TFS.map((t) => ({ value: t, label: t }))} />}
          right={
            <div className="flex gap-3 text-xs text-muted">
              {(['ema', 'bb', 'st'] as const).map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-1">
                  <input type="checkbox" checked={layers[k]} onChange={() => setLayers({ ...layers, [k]: !layers[k] })} />
                  {k === 'ema' ? 'EMA 20/50/200' : k === 'bb' ? 'Bollinger' : 'Supertrend'}
                </label>
              ))}
            </div>
          }
        >
          {candles.data?.length ? <PriceChart candles={candles.data} overlays={overlays} markers={markers} /> : <Empty>Brak świec dla {tf}. Worker pobierze je przy najbliższym zamknięciu świecy.</Empty>}
        </Card>
        <Card title="Analiza techniczna">
          {s ? (
            <div className="space-y-3 text-sm">
              <Row k="Trend (EMA)" v={<span className={tone(s.trend.score)}>{s.trend.score > 0 ? '+' : ''}{s.trend.score} / 3</span>} />
              <Row k="Supertrend" v={<span className={s.trend.supertrend === 'up' ? 'text-up' : 'text-down'}>{s.trend.supertrend === 'up' ? 'wzrostowy' : 'spadkowy'}</span>} />
              <Row k="ADX" v={num(s.trend.adx, 1)} />
              <Row k="RSI 14" v={<span className={(s.momentum.rsi14 ?? 50) > 70 ? 'text-down' : (s.momentum.rsi14 ?? 50) < 30 ? 'text-up' : ''}>{num(s.momentum.rsi14, 1)}</span>} />
              <Row k="MACD hist" v={<span className={tone(s.momentum.macdHist)}>{num(s.momentum.macdHist, 4)}</span>} />
              <Row k="Stoch %K" v={num(s.momentum.stochK, 1)} />
              <Row k="MFI" v={num(s.momentum.mfi14, 1)} />
              <Row k="ATR %" v={`${num(s.volatility.atrPct)}%`} />
              <Row k="Bollinger %B" v={num(s.volatility.bbPercentB)} />
              <Row k="Wolumen z-score" v={num(s.volume.zScore)} />
              <Row k="Opór / wsparcie 20" v={`${price(s.levels.donchianHigh20)} / ${price(s.levels.donchianLow20)}`} />
              {s.levels.pivot && <Row k="Pivot P / R1 / S1" v={`${price(s.levels.pivot.p)} / ${price(s.levels.pivot.r1)} / ${price(s.levels.pivot.s1)}`} />}
              {s.signals.length > 0 && (
                <ul className="space-y-1 border-t border-line pt-3">
                  {s.signals.map((x) => (
                    <li key={x} className="text-xs text-muted">
                      • {x}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <Empty>Za mało danych (min. 30 świec).</Empty>
          )}
        </Card>

        <Card title="Decyzje agentów dla tego rynku" className="xl:col-span-3">
          <DecisionsTable rows={decisions.data ?? []} />
        </Card>
        <div className="space-y-4">
          {fundamentals.data?.[0] && (
            <Card title="Fundamenty">
              <div className="space-y-1.5 text-sm">
                {Object.entries(fundamentals.data[0].data).map(([k, v]) => (
                  <Row key={k} k={k} v={typeof v === 'number' ? num(v) : String(v ?? '–')} />
                ))}
              </div>
            </Card>
          )}
          <Card title="Newsy">
            {news.data?.length ? (
              <ul className="space-y-2.5 text-sm">
                {news.data.map((n) => (
                  <li key={n.id}>
                    <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-accent">
                      {n.title}
                    </a>
                    <div className="text-xs text-muted">
                      {n.source} · {dt(n.ts)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Brak newsów.</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}

