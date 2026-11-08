'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { EXIT_LABEL, dt, pct, price, tone } from '@/lib/format';
import { ActionBadge, Empty, StatusBadge } from './ui';

export interface DecisionRow {
  decision: {
    id: string; agentId: string; model?: string; instrumentId: string; timeframe: string; action: string; confidence: number;
    entryPrice?: number; stopLoss?: number; takeProfit?: number; horizonBars: number; rationale: string; evidence?: string[]; sources?: string[];
    createdAt: number; priceAtDecision?: number; risk?: { approved: boolean; sizePct: number; reasons: string[] };
  };
  result: { status: string; returnPct: number; rMultiple: number | null; exitReason: string | null; directionCorrect: boolean | null; entryPrice?: number; exitPrice?: number } | null;
}

export function DecisionsTable({ rows, compact = false }: { rows: DecisionRow[]; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty>Brak decyzji. Uruchom agenta w zakładce „Agenci” albo podłącz agenta przez MCP.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="grid-table w-full">
        <thead>
          <tr>
            <th>Czas</th>
            <th>Instrument</th>
            <th>Akcja</th>
            {!compact && <th>Agent</th>}
            <th className="text-right">Pewność</th>
            {!compact && <th className="text-right">Cena</th>}
            {!compact && <th className="text-right">SL / TP</th>}
            <th>Status</th>
            <th className="text-right">Wynik</th>
            {!compact && <th className="text-right">R</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ decision: d, result: r }) => (
            <Fragment key={d.id}>
              <tr className="cursor-pointer" onClick={() => setOpen(open === d.id ? null : d.id)}>
                <td className="num whitespace-nowrap text-muted">{dt(d.createdAt)}</td>
                <td className="whitespace-nowrap">
                  <Link href={`/markets/${encodeURIComponent(d.instrumentId)}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent">
                    {d.instrumentId.split(':')[1]}
                  </Link>
                  <span className="ml-1 text-xs text-muted">{d.timeframe}</span>
                </td>
                <td>
                  <ActionBadge action={d.action} />
                  {d.risk && !d.risk.approved && d.action !== 'hold' && <span className="ml-1 text-[10px] text-warn" title={d.risk.reasons.join(', ')}>⚠ ryzyko</span>}
                </td>
                {!compact && <td className="text-muted">{d.agentId}</td>}
                <td className="num text-right">{Math.round(d.confidence * 100)}%</td>
                {!compact && <td className="num text-right">{price(d.priceAtDecision)}</td>}
                {!compact && (
                  <td className="num whitespace-nowrap text-right text-xs text-muted">
                    {price(d.stopLoss)} / {price(d.takeProfit)}
                  </td>
                )}
                <td>
                  <StatusBadge status={r?.status} />
                  {r?.exitReason && <span className="ml-1 text-[10px] text-muted">{EXIT_LABEL[r.exitReason]}</span>}
                </td>
                <td className={`num text-right ${d.action === 'hold' ? (r?.directionCorrect === null || !r ? 'text-muted' : r.directionCorrect ? 'text-up' : 'text-down') : tone(r?.returnPct)}`}>
                  {d.action === 'hold' ? (r?.directionCorrect === null || !r ? '–' : r.directionCorrect ? 'trafne' : 'chybione') : pct(r?.returnPct)}
                </td>
                {!compact && <td className={`num text-right ${tone(r?.rMultiple)}`}>{r?.rMultiple === null || r?.rMultiple === undefined ? '–' : r.rMultiple.toFixed(2)}</td>}
              </tr>
              {open === d.id && (
                <tr>
                  <td colSpan={compact ? 6 : 10} className="bg-black/20">
                    <div className="space-y-2 py-1 text-sm">
                      <p>{d.rationale}</p>
                      {!!d.evidence?.length && (
                        <ul className="flex flex-wrap gap-1.5">
                          {d.evidence.map((e, i) => (
                            <li key={i} className="rounded bg-white/5 px-2 py-0.5 text-xs text-muted">{e}</li>
                          ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                        <span>Model: {d.model ?? '–'}</span>
                        <span>Horyzont: {d.horizonBars} świec</span>
                        {r?.entryPrice && <span>Wejście: {price(r.entryPrice)}</span>}
                        {r?.exitPrice && <span>Wyjście: {price(r.exitPrice)}</span>}
                        {d.risk && <span>Ryzyko: {d.risk.approved ? `OK, pozycja ${pct(d.risk.sizePct, 1, false)} kapitału` : d.risk.reasons.join(', ')}</span>}
                        {!!d.sources?.length && <span>Źródła: {d.sources.join(', ')}</span>}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
