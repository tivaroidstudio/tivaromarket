import { money, num, pct, tone } from '@/lib/format';
import { Empty } from './ui';

export interface LeaderRow {
  agentId: string;
  name: string;
  provider: string;
  model: string;
  stats: {
    decisions: number; trades: number; openTrades: number; winRate: number | null; profitFactor: number | null | string;
    avgR: number | null; directionalAccuracy: number | null; tradeSharpe: number | null; avgReturnPct: number | null;
  };
  portfolio: { equity: number; returnPct: number; maxDrawdownPct: number; openTrades: number; rejected: number };
}

export function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  if (!rows.length) return <Empty>Brak agentów.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="grid-table w-full">
        <thead>
          <tr>
            <th>#</th>
            <th>Agent</th>
            <th className="text-right">Portfel</th>
            <th className="text-right">Zwrot</th>
            <th className="text-right">Max DD</th>
            <th className="text-right">Transakcje</th>
            <th className="text-right">Win rate</th>
            <th className="text-right">Profit factor</th>
            <th className="text-right">Śr. R</th>
            <th className="text-right">Trafność kierunku</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.agentId}>
              <td className="num text-muted">{i + 1}</td>
              <td>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted">
                  {r.provider} · {r.model}
                </div>
              </td>
              <td className="num text-right">{money(r.portfolio.equity)}</td>
              <td className={`num text-right font-semibold ${tone(r.portfolio.returnPct)}`}>{pct(r.portfolio.returnPct)}</td>
              <td className="num text-right text-down">{pct(r.portfolio.maxDrawdownPct)}</td>
              <td className="num text-right">
                {r.stats.trades}
                {r.stats.openTrades > 0 && <span className="text-xs text-accent"> +{r.stats.openTrades}</span>}
              </td>
              <td className="num text-right">{pct(r.stats.winRate, 1, false)}</td>
              <td className="num text-right">{num(r.stats.profitFactor)}</td>
              <td className={`num text-right ${tone(r.stats.avgR)}`}>{num(r.stats.avgR)}</td>
              <td className="num text-right">{pct(r.stats.directionalAccuracy, 1, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">
        Ranking liczony wyłącznie na świecach, które przyszły po decyzji (forward test), z prowizją i poślizgiem. Mało transakcji = wynik
        statystycznie niewiarygodny; patrz na co najmniej ~30–50 zamkniętych transakcji.
      </p>
    </div>
  );
}
