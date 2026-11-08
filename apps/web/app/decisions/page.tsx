'use client';
import { useState } from 'react';
import { useApi } from '@/lib/api';
import { Card, ErrorBox, PageHeader, Pills } from '@/components/ui';
import { DecisionsTable, type DecisionRow } from '@/components/DecisionsTable';

export default function Decisions() {
  const agents = useApi<{ id: string; name: string }[]>('/agents');
  const [agentId, setAgentId] = useState('');
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [action, setAction] = useState<'all' | 'trades' | 'hold'>('trades');
  const { data, error } = useApi<DecisionRow[]>(`/decisions?limit=500&mode=${mode}${agentId ? `&agentId=${agentId}` : ''}`, 30_000);
  const rows = (data ?? []).filter((r) => (action === 'all' ? true : action === 'hold' ? r.decision.action === 'hold' : r.decision.action !== 'hold'));
  return (
    <>
      <PageHeader title="Dziennik decyzji" subtitle="Każda decyzja AI z uzasadnieniem, poziomami SL/TP, oceną ryzyka i wynikiem na danych, które przyszły później." />
      <ErrorBox error={error} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">Wszyscy agenci</option>
          {(agents.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Pills value={action} onChange={setAction} options={[{ value: 'trades', label: 'Kup/Sprzedaj' }, { value: 'hold', label: 'Trzymaj' }, { value: 'all', label: 'Wszystkie' }]} />
        <Pills value={mode} onChange={setMode} options={[{ value: 'live', label: 'Na żywo' }, { value: 'replay', label: 'Replay (historia)' }]} />
      </div>
      <Card>
        <DecisionsTable rows={rows} />
      </Card>
    </>
  );
}
