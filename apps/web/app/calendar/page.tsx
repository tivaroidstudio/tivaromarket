'use client';
import { useMemo, useState } from 'react';
import { useApi } from '@/lib/api';
import { Card, Empty, ErrorBox, Importance, PageHeader, Pills } from '@/components/ui';

interface Ev { id: string; ts: number; kind: string; title: string; country?: string; symbol?: string; importance: number; actual?: string | null; forecast?: string | null; previous?: string | null; source: string }

const KIND: Record<string, string> = { macro: 'Makro', central_bank: 'Bank centralny', earnings: 'Wyniki spółek', crypto: 'Krypto', dividend: 'Dywidenda', ipo: 'IPO', other: 'Inne' };

export default function Calendar() {
  const [min, setMin] = useState<'1' | '2' | '3'>('2');
  const [kind, setKind] = useState<'all' | 'macro' | 'central_bank' | 'earnings'>('all');
  const { data, error } = useApi<Ev[]>(`/events?minImportance=${min}&from=${Date.now() - 2 * 86_400_000}&to=${Date.now() + 14 * 86_400_000}${kind === 'all' ? '' : `&kind=${kind}`}`, 300_000);
  const days = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of data ?? []) {
      const d = new Date(e.ts).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(e);
    }
    return [...m.entries()];
  }, [data]);
  return (
    <>
      <PageHeader title="Kalendarz wydarzeń" subtitle="CPI, NFP, decyzje banków centralnych, PMI i wyniki spółek. Agenci widzą to w briefie i biorą pod uwagę przed wejściem w pozycję." />
      <ErrorBox error={error} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Pills value={min} onChange={setMin} options={[{ value: '3', label: 'Tylko ważne' }, { value: '2', label: 'Średnie+' }, { value: '1', label: 'Wszystkie' }]} />
        <Pills value={kind} onChange={setKind} options={[{ value: 'all', label: 'Wszystko' }, { value: 'macro', label: 'Makro' }, { value: 'central_bank', label: 'Banki centralne' }, { value: 'earnings', label: 'Wyniki' }]} />
      </div>
      {days.length === 0 && <Empty>Brak wydarzeń. Kalendarz makro pobiera się bez klucza; wyniki spółek wymagają FINNHUB_API_KEY.</Empty>}
      <div className="space-y-4">
        {days.map(([day, evs]) => (
          <Card key={day} title={<span className="capitalize text-text">{day}</span>}>
            <table className="grid-table w-full">
              <thead>
                <tr>
                  <th className="w-16">Godz.</th>
                  <th className="w-14">Kraj</th>
                  <th>Wydarzenie</th>
                  <th className="w-20">Ważność</th>
                  <th className="text-right">Aktualnie</th>
                  <th className="text-right">Prognoza</th>
                  <th className="text-right">Poprzednio</th>
                </tr>
              </thead>
              <tbody>
                {evs.map((e) => (
                  <tr key={e.id} className={e.ts < Date.now() ? 'opacity-60' : ''}>
                    <td className="num text-muted">{new Date(e.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="text-muted">{e.country ?? e.symbol}</td>
                    <td>
                      {e.title} <span className="text-xs text-muted">· {KIND[e.kind] ?? e.kind}</span>
                    </td>
                    <td>
                      <Importance level={e.importance} />
                    </td>
                    <td className="num text-right font-medium">{e.actual ?? '–'}</td>
                    <td className="num text-right text-muted">{e.forecast ?? '–'}</td>
                    <td className="num text-right text-muted">{e.previous ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
    </>
  );
}
