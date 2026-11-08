'use client';
import { useState } from 'react';
import { useApi } from '@/lib/api';
import { ago, money, num } from '@/lib/format';
import { Card, Empty, ErrorBox, PageHeader } from '@/components/ui';

interface News { id: string; ts: number; source: string; title: string; url?: string; summary?: string; symbols?: string[]; sentiment?: number }
interface Metric { key: string; ts: number; value: number; source: string; prev24h?: number; meta?: { label?: string } }
interface Whale { id: string; ts: number; chain: string; symbol: string; amountUsd: number; from?: string; to?: string; flow: string }

const METRIC_LABEL: Record<string, string> = {
  'sentiment.crypto_fear_greed': 'Fear & Greed (krypto)',
  'btc.fee.fastest_sat_vb': 'BTC opłata (sat/vB)',
  'btc.hashrate_ehs': 'BTC hashrate (EH/s)',
  'defi.tvl_usd_bn': 'DeFi TVL (mld $)',
  'stablecoins.total_usd_bn': 'Stablecoiny łącznie (mld $)',
  'eth.gas.propose_gwei': 'ETH gas (gwei)',
  'macro.us.yield_10y': 'US 10Y (%)',
  'macro.us.yield_2y': 'US 2Y (%)',
  'macro.us.curve_10y2y': 'Krzywa 10Y–2Y',
  'macro.us.vix': 'VIX',
  'macro.us.fed_funds': 'Fed funds (%)',
};

export default function NewsPage() {
  const [q, setQ] = useState('');
  const news = useApi<News[]>(`/news?limit=120${q ? `&q=${encodeURIComponent(q)}` : ''}`, 60_000);
  const metrics = useApi<Metric[]>('/onchain', 300_000);
  const whales = useApi<Whale[]>('/whales?limit=40&minUsd=1000000', 60_000);
  return (
    <>
      <PageHeader title="Newsy, on-chain i wieloryby" subtitle="Źródła, które czytają agenci: RSS, GDELT (geopolityka), Finnhub, Benzinga, CryptoPanic, DefiLlama, mempool, funding, FRED." />
      <ErrorBox error={news.error} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Wiadomości" className="xl:col-span-2" right={<input className="input w-48 text-xs" placeholder="Filtruj (np. OPEC, Fed, BTC)" value={q} onChange={(e) => setQ(e.target.value)} />}>
          {news.data?.length ? (
            <ul className="divide-y divide-line">
              {news.data.map((n) => (
                <li key={n.id} className="py-2.5">
                  <a href={n.url} target="_blank" rel="noreferrer" className="text-sm hover:text-accent">
                    {n.title}
                  </a>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted">
                    <span>{n.source}</span>
                    <span>{ago(n.ts)}</span>
                    {n.symbols?.slice(0, 5).map((s) => (
                      <span key={s} className="rounded bg-white/5 px-1.5">
                        {s}
                      </span>
                    ))}
                    {n.sentiment !== undefined && n.sentiment !== null && <span className={n.sentiment > 0 ? 'text-up' : 'text-down'}>sentyment {num(n.sentiment)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Newsy pobierają się co 15 minut.</Empty>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="On-chain, derywaty, makro">
            {metrics.data?.length ? (
              <table className="grid-table w-full">
                <tbody>
                  {metrics.data.map((m) => {
                    const ch = m.prev24h ? (m.value - m.prev24h) / Math.abs(m.prev24h) : null;
                    return (
                      <tr key={m.key}>
                        <td className="text-xs">{METRIC_LABEL[m.key] ?? m.key}</td>
                        <td className="num text-right">
                          {num(m.value)}
                          {m.meta?.label && <span className="ml-1 text-xs text-muted">{m.meta.label}</span>}
                        </td>
                        <td className={`num text-right text-xs ${ch === null ? 'text-muted' : ch > 0 ? 'text-up' : 'text-down'}`}>{ch === null ? '' : `${(ch * 100).toFixed(1)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <Empty>Brak metryk.</Empty>
            )}
          </Card>
          <Card title="Wieloryby (≥ $1 mln)">
            {whales.data?.length ? (
              <ul className="space-y-2 text-sm">
                {whales.data.map((w) => (
                  <li key={w.id} className="flex justify-between gap-2">
                    <span>
                      <span className={w.flow === 'exchange_inflow' ? 'text-down' : w.flow === 'exchange_outflow' ? 'text-up' : 'text-muted'}>
                        {w.flow === 'exchange_inflow' ? '→ giełda' : w.flow === 'exchange_outflow' ? '← z giełdy' : '↔'}
                      </span>{' '}
                      {w.symbol} <span className="text-xs text-muted">{w.to ?? ''}</span>
                    </span>
                    <span className="num text-xs">
                      {money(w.amountUsd)} · {ago(w.ts)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Wymaga WHALE_ALERT_API_KEY.</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
