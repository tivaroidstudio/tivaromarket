'use client';
import { useState } from 'react';
import { useApi } from '@/lib/api';
import { ASSET_LABEL, money, num, pct, tone } from '@/lib/format';
import { Card, Empty, ErrorBox, PageHeader, Pills } from '@/components/ui';
import { Leaderboard, type LeaderRow } from '@/components/Leaderboard';
import { LineChart } from '@/components/PriceChart';

interface Stats {
  decisions: number; trades: number; winRate: number | null; profitFactor: number | null | string; avgReturnPct: number | null;
  directionalAccuracy: number | null; maxDrawdownPct: number; calibration: { from: number; to: number; n: number; hitRate: number | null }[];
}

const RANGES = [
  { value: '0', label: 'Całość' },
  { value: '90', label: '90 dni' },
  { value: '30', label: '30 dni' },
  { value: '7', label: '7 dni' },
];

export default function ForwardTest() {
  const [range, setRange] = useState('0');
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const since = range === '0' ? 0 : Date.now() - Number(range) * 86_400_000;
  const lb = useApi<{ agents: LeaderRow[]; byTimeframe: Record<string, Stats>; byAssetClass: Record<string, Stats>; byAgentTimeframe: Record<string, Stats> }>(`/leaderboard?since=${since}&mode=${mode}`, 60_000);
  const [agent, setAgent] = useState<string>('');
  const chosen = agent || lb.data?.agents[0]?.agentId || '';
  const pf = useApi<{ curve: { t: number; equity: number }[]; initialEquity: number; stats: Stats; rejected: { decisionId: string; reasons: string[] }[] }>(
    chosen ? `/portfolio?agentId=${chosen}&mode=${mode}` : null,
    60_000,
  );

  return (
    <>
      <PageHeader
        title="Forward test"
        subtitle="Decyzje są rozliczane wyłącznie na świecach, które otworzyły się po decyzji: z prowizją, poślizgiem i konserwatywnym SL przed TP. Liczy się co interwał i raz dziennie od nowa."
        right={
          <div className="flex gap-2">
            <Pills value={mode} onChange={setMode} options={[{ value: 'live', label: 'Na żywo' }, { value: 'replay', label: 'Replay' }]} />
            <Pills value={range} onChange={setRange} options={RANGES} />
          </div>
        }
      />
      <ErrorBox error={lb.error} />
      <Card title="Ranking agentów" className="mb-4">
        <Leaderboard rows={lb.data?.agents ?? []} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Krzywa kapitału (paper portfolio z regułami ryzyka)"
          className="xl:col-span-2"
          right={
            <select className="input text-xs" value={chosen} onChange={(e) => setAgent(e.target.value)}>
              {(lb.data?.agents ?? []).map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {a.name}
                </option>
              ))}
            </select>
          }
        >
          {pf.data && pf.data.curve.length > 1 ? (
            <LineChart points={pf.data.curve.map((p) => ({ t: p.t, v: p.equity }))} baseline={pf.data.initialEquity} color="#1fc77e" />
          ) : (
            <Empty>Krzywa pojawi się po pierwszych zamkniętych transakcjach.</Empty>
          )}
          {pf.data && pf.data.rejected.length > 0 && <p className="mt-2 text-xs text-muted">Odrzucone przez silnik ryzyka: {pf.data.rejected.length} decyzji.</p>}
        </Card>
        <Card title="Kalibracja pewności">
          {pf.data?.stats.calibration.some((b) => b.n > 0) ? (
            <div className="space-y-2">
              {pf.data.stats.calibration.map((b) => (
                <div key={b.from} className="text-sm">
                  <div className="mb-0.5 flex justify-between text-xs text-muted">
                    <span>
                      pewność {Math.round(b.from * 100)}–{Math.round(b.to * 100)}%
                    </span>
                    <span>
                      {b.n} dec. · trafność {pct(b.hitRate, 0, false)}
                    </span>
                  </div>
                  <div className="h-2 rounded bg-white/5">
                    <div className="h-2 rounded bg-accent" style={{ width: `${(b.hitRate ?? 0) * 100}%` }} />
                  </div>
                </div>
              ))}
              <p className="pt-2 text-xs text-muted">Dobrze skalibrowany agent: im wyższa pewność, tym wyższa trafność.</p>
            </div>
          ) : (
            <Empty>Brak rozliczonych decyzji.</Empty>
          )}
        </Card>

        <Card title="Wg interwału">
          <GroupTable data={lb.data?.byTimeframe} label={(k) => k} />
        </Card>
        <Card title="Wg klasy aktywów">
          <GroupTable data={lb.data?.byAssetClass} label={(k) => ASSET_LABEL[k] ?? k} />
        </Card>
        <Card title="Agent × interwał">
          <GroupTable data={lb.data?.byAgentTimeframe} label={(k) => k.replace('|', ' · ')} />
        </Card>
      </div>
      <p className="mt-6 text-xs text-muted">Kapitał startowy paper: {money(pf.data?.initialEquity ?? 10000)}. To symulacja, nie porada inwestycyjna.</p>
    </>
  );
}

function GroupTable({ data, label }: { data?: Record<string, Stats>; label: (k: string) => string }) {
  const entries = Object.entries(data ?? {});
  if (!entries.length) return <Empty>Brak danych.</Empty>;
  return (
    <table className="grid-table w-full">
      <thead>
        <tr>
          <th>Grupa</th>
          <th className="text-right">Trans.</th>
          <th className="text-right">Win</th>
          <th className="text-right">Śr.</th>
          <th className="text-right">PF</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([k, s]) => (
          <tr key={k}>
            <td>{label(k)}</td>
            <td className="num text-right">{s.trades}</td>
            <td className="num text-right">{pct(s.winRate, 0, false)}</td>
            <td className={`num text-right ${tone(s.avgReturnPct)}`}>{pct(s.avgReturnPct)}</td>
            <td className="num text-right">{num(s.profitFactor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
