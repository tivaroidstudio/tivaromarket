'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { Card, ErrorBox, PageHeader } from '@/components/ui';

interface Settings {
  risk: Record<string, any>;
  timeframes: string[];
  allTimeframes: string[];
  paperInitialEquity: number;
  forwardTest: { feeBps: number; slippageBps: number; holdBandPct: number };
}
interface Source { id: string; kind: string; label: string; missing: string[]; available: boolean; notes?: string }

const RISK_FIELDS: { key: string; label: string; pct?: boolean }[] = [
  { key: 'riskPerTradePct', label: 'Ryzyko na transakcję', pct: true },
  { key: 'maxPositionPct', label: 'Maks. wielkość pozycji', pct: true },
  { key: 'maxGrossExposurePct', label: 'Maks. łączna ekspozycja', pct: true },
  { key: 'maxDailyLossPct', label: 'Dzienny limit straty', pct: true },
  { key: 'maxDrawdownPct', label: 'Maks. obsunięcie (stop wszystkiego)', pct: true },
  { key: 'minConfidence', label: 'Min. pewność AI', pct: true },
  { key: 'maxOpenPositions', label: 'Maks. otwartych pozycji' },
];

const KIND: Record<string, string> = { candles: 'Notowania', news: 'Newsy', calendar: 'Kalendarze', onchain: 'On-chain / makro', whales: 'Wieloryby', broker: 'Broker' };

export default function SettingsPage() {
  const s = useApi<Settings>('/settings');
  const sources = useApi<Source[]>('/sources');
  const [risk, setRisk] = useState<Record<string, any>>({});
  const [tfs, setTfs] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | undefined>();
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => {
    if (s.data) {
      setRisk(s.data.risk);
      setTfs(s.data.timeframes);
    }
  }, [s.data]);

  const save = async () => {
    try {
      await api('/settings', { method: 'PUT', body: { risk, timeframes: tfs } });
      setSaved('Zapisano.');
      setTimeout(() => setSaved(undefined), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageHeader title="Ustawienia" subtitle="Reguły ryzyka obowiązują każdego agenta. AI proponuje, silnik ryzyka decyduje o wielkości pozycji." right={<button className="btn btn-primary" onClick={save}>{saved ?? 'Zapisz'}</button>} />
      <ErrorBox error={err ?? s.error} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Zarządzanie ryzykiem">
          <div className="space-y-3 text-sm">
            {RISK_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3">
                <span className="text-muted">{f.label}</span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    step={f.pct ? 0.5 : 1}
                    className="input num w-24 text-right"
                    value={risk[f.key] === undefined ? '' : f.pct ? +(risk[f.key] * 100).toFixed(2) : risk[f.key]}
                    onChange={(e) => setRisk({ ...risk, [f.key]: f.pct ? Number(e.target.value) / 100 : Number(e.target.value) })}
                  />
                  <span className="w-4 text-muted">{f.pct ? '%' : ''}</span>
                </span>
              </label>
            ))}
            {[
              { key: 'requireStopLoss', label: 'Wymagaj stop lossa' },
              { key: 'allowShort', label: 'Pozwól na krótką sprzedaż' },
              { key: 'killSwitch', label: 'KILL SWITCH — blokuj nowe pozycje' },
            ].map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3">
                <span className={f.key === 'killSwitch' ? 'text-down' : 'text-muted'}>{f.label}</span>
                <input type="checkbox" checked={!!risk[f.key]} onChange={(e) => setRisk({ ...risk, [f.key]: e.target.checked })} />
              </label>
            ))}
          </div>
        </Card>
        <Card title="Aktywne interwały">
          <div className="flex flex-wrap gap-2">
            {(s.data?.allTimeframes ?? []).map((t) => (
              <button key={t} onClick={() => setTfs(tfs.includes(t) ? tfs.filter((x) => x !== t) : [...tfs, t])} className={`rounded-lg px-3 py-1.5 text-sm ${tfs.includes(t) ? 'bg-accent text-white' : 'bg-white/5 text-muted'}`}>
                {t}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Na każdym aktywnym interwale worker pobiera świece po zamknięciu, rozlicza decyzje i uruchamia agentów, którzy mają ten interwał. Codziennie o 00:10 UTC robi pełne przeliczenie i raport.
          </p>
          {s.data && (
            <p className="mt-3 text-xs text-muted">
              Forward test: prowizja {s.data.forwardTest.feeBps} bps/strona, poślizg {s.data.forwardTest.slippageBps} bps, kapitał paper ${s.data.paperInitialEquity.toLocaleString('pl-PL')}.
            </p>
          )}
        </Card>
        <Card title="Źródła danych">
          <ul className="space-y-2 text-sm">
            {(sources.data ?? []).map((x) => (
              <li key={x.id} className="flex items-start justify-between gap-2" title={x.notes}>
                <span>
                  <span className={x.available ? 'text-up' : 'text-muted'}>●</span> {x.label}
                  <span className="ml-1 text-xs text-muted">{KIND[x.kind] ?? x.kind}</span>
                </span>
                {!x.available && <span className="shrink-0 text-[11px] text-warn">{x.missing.join(', ')}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Klucze ustawiasz w pliku .env workera (patrz .env.example). Darmowe źródła działają od razu.</p>
        </Card>
      </div>
    </>
  );
}
