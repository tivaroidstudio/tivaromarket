'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { ASSET_LABEL, ago, pct, price, tone } from '@/lib/format';
import { Card, ErrorBox, PageHeader, Pills } from '@/components/ui';

interface Inst { id: string; symbol: string; name: string; assetClass: string; provider: string; venue?: string; enabled: boolean; last: number | null; change1d: number | null; lastTime: number | null }

const CLASSES = ['all', 'crypto', 'stock', 'etf', 'index', 'forex', 'commodity'] as const;

export default function Markets() {
  const { data, error, reload } = useApi<Inst[]>('/instruments', 60_000);
  const [cls, setCls] = useState<(typeof CLASSES)[number]>('all');
  const [q, setQ] = useState('');
  const rows = useMemo(
    () => (data ?? []).filter((i) => (cls === 'all' || i.assetClass === cls) && (!q || `${i.symbol} ${i.name}`.toLowerCase().includes(q.toLowerCase()))),
    [data, cls, q],
  );
  const toggle = async (i: Inst) => {
    await api(`/instruments/${encodeURIComponent(i.id)}`, { method: 'PATCH', body: { enabled: !i.enabled } });
    void reload();
  };
  return (
    <>
      <PageHeader title="Rynki" subtitle="Krypto, akcje, ETF, indeksy, forex i surowce. Wyłączone rynki nie są analizowane przez agentów." />
      <ErrorBox error={error} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Pills value={cls} onChange={setCls} options={CLASSES.map((c) => ({ value: c, label: c === 'all' ? 'Wszystkie' : ASSET_LABEL[c] }))} />
        <input className="input w-56" placeholder="Szukaj…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="grid-table w-full">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Klasa</th>
                <th className="text-right">Cena</th>
                <th className="text-right">1D</th>
                <th>Dane</th>
                <th>Wykonanie</th>
                <th className="text-right">Aktywny</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={i.enabled ? '' : 'opacity-50'}>
                  <td>
                    <Link href={`/markets/${encodeURIComponent(i.id)}`} className="font-medium hover:text-accent">
                      {i.symbol}
                    </Link>
                    <div className="text-xs text-muted">{i.name}</div>
                  </td>
                  <td className="text-muted">{ASSET_LABEL[i.assetClass]}</td>
                  <td className="num text-right">{price(i.last)}</td>
                  <td className={`num text-right ${tone(i.change1d)}`}>{pct(i.change1d)}</td>
                  <td className="text-xs text-muted">
                    {i.provider} · {ago(i.lastTime)}
                  </td>
                  <td className="text-xs text-muted">{i.venue === 'xtb-manual' ? 'XTB (ręcznie)' : i.venue ?? '–'}</td>
                  <td className="text-right">
                    <button onClick={() => toggle(i)} className={`h-5 w-9 rounded-full transition ${i.enabled ? 'bg-accent' : 'bg-white/10'}`} aria-label="przełącz">
                      <span className={`block h-4 w-4 rounded-full bg-white transition ${i.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
