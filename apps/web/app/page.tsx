'use client';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { ago, dt, money, pct, tone } from '@/lib/format';
import { Card, Empty, ErrorBox, Importance, PageHeader, Stat } from '@/components/ui';
import { Leaderboard, type LeaderRow } from '@/components/Leaderboard';
import { DecisionsTable, type DecisionRow } from '@/components/DecisionsTable';

interface Overview {
  instruments: number;
  enabledInstruments: number;
  timeframes: string[];
  agents: number;
  leaderboard: LeaderRow[];
  recentDecisions: DecisionRow[];
  runs: { id: string; agentId: string; startedAt: number; status: string; decisions?: number; scope?: string; error?: string; summary?: string; inputTokens?: number; outputTokens?: number }[];
  upcoming: { id: string; ts: number; title: string; country?: string; importance: number; forecast?: string | null; previous?: string | null }[];
  llmProviders: { id: string; label: string; available: boolean }[];
}

export default function Dashboard() {
  const { data, error } = useApi<Overview>('/overview', 30_000);
  const best = data?.leaderboard[0];
  const lastView = data?.runs.find((r) => r.summary)?.summary;
  return (
    <>
      <PageHeader title="Pulpit" subtitle="Co robią agenci, jak im idzie na danych z przyszłości i co nadchodzi na rynku." />
      <ErrorBox error={error} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Najlepszy agent" value={best ? pct(best.portfolio.returnPct) : '–'} tone={tone(best?.portfolio.returnPct)} hint={best ? `${best.name} · ${money(best.portfolio.equity)}` : 'brak danych'} />
        <Stat label="Decyzje (łącznie)" value={data ? data.leaderboard.reduce((a, r) => a + r.stats.decisions, 0) : '–'} hint={`${data?.agents ?? 0} agentów`} />
        <Stat label="Otwarte pozycje" value={data ? data.leaderboard.reduce((a, r) => a + r.portfolio.openTrades, 0) : '–'} hint="paper trading" />
        <Stat label="Rynki" value={data ? `${data.enabledInstruments}/${data.instruments}` : '–'} hint={data ? `interwały: ${data.timeframes.join(', ')}` : ''} />
      </div>

      {data && !data.llmProviders.some((p) => p.available) && (
        <div className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          Brak kluczy API do modeli AI — działa tylko agent bazowy (wskaźniki). Dodaj np. <code>ANTHROPIC_API_KEY</code> lub <code>GEMINI_API_KEY</code> w pliku <code>.env</code>
          {' '}albo podłącz Claude Code / Codex przez MCP (zakładka <Link href="/agents" className="underline">Agenci</Link>).
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Ranking agentów (forward test)" className="xl:col-span-2" right={<Link href="/forward-test" className="text-xs text-accent">szczegóły →</Link>}>
          <Leaderboard rows={data?.leaderboard ?? []} />
        </Card>
        <Card title="Nadchodzące ważne wydarzenia" right={<Link href="/calendar" className="text-xs text-accent">kalendarz →</Link>}>
          {data?.upcoming.length ? (
            <ul className="space-y-2.5">
              {data.upcoming.map((e) => (
                <li key={e.id} className="flex items-start gap-3 text-sm">
                  <span className="num w-20 shrink-0 text-xs text-muted">{dt(e.ts)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="mr-1.5 text-xs text-muted">{e.country}</span>
                      {e.title}
                    </div>
                    {(e.forecast || e.previous) && (
                      <div className="text-xs text-muted">
                        prognoza {e.forecast ?? '–'} · poprz. {e.previous ?? '–'}
                      </div>
                    )}
                  </div>
                  <Importance level={e.importance} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Kalendarz pobiera się automatycznie co godzinę.</Empty>
          )}
        </Card>

        <Card title="Ostatnie decyzje AI" className="xl:col-span-2" right={<Link href="/decisions" className="text-xs text-accent">dziennik →</Link>}>
          <DecisionsTable rows={data?.recentDecisions ?? []} compact />
        </Card>
        <Card title="Ostatnie przebiegi agentów">
          {lastView && <p className="mb-3 rounded-lg bg-accent/10 p-3 text-sm leading-relaxed">{lastView}</p>}
          <ul className="space-y-2 text-sm">
            {(data?.runs ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <span className={r.status === 'ok' ? 'text-up' : r.status === 'error' ? 'text-down' : 'text-warn'}>●</span> {r.agentId}{' '}
                  <span className="text-xs text-muted">{r.scope}</span>
                </span>
                <span className="shrink-0 text-xs text-muted" title={r.error}>
                  {r.decisions ?? 0} dec. · {ago(r.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
