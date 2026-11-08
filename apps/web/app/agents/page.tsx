'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { ago } from '@/lib/format';
import { Card, ErrorBox, PageHeader } from '@/components/ui';

interface Agent { id: string; name: string; provider: string; model: string; enabled: boolean; config: { timeframes?: string[]; webSearch?: boolean; style?: string; instruments?: string[]; language?: string; everyMinutes?: number } }
interface Overview { llmProviders: { id: string; label: string; available: boolean; defaultModel: string }[] }

const TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

export default function Agents() {
  const agents = useApi<Agent[]>('/agents', 30_000);
  const runs = useApi<any[]>('/runs?limit=30', 15_000);
  const ov = useApi<Overview>('/overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | undefined>();
  const [err, setErr] = useState<string | undefined>();
  const providers = ov.data?.llmProviders ?? [];
  const [form, setForm] = useState({ id: '', name: '', provider: 'anthropic', model: '', timeframes: ['4h', '1d'], webSearch: true, style: '' });

  const run = async (a: Agent, timeframe: string) => {
    setBusy(a.id);
    setErr(undefined);
    try {
      const r = await api<{ decisions: unknown[]; errors: string[] }>(`/agents/${a.id}/run`, { method: 'POST', body: { timeframe } });
      setMsg(`${a.name}: ${r.decisions.length} decyzji${r.errors.length ? `, uwagi: ${r.errors.slice(0, 2).join('; ')}` : ''}`);
      void runs.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const toggle = async (a: Agent) => {
    await api(`/agents/${a.id}`, { method: 'PATCH', body: { enabled: !a.enabled } });
    void agents.reload();
  };
  const create = async () => {
    setErr(undefined);
    try {
      await api('/agents', {
        method: 'POST',
        body: {
          id: form.id, name: form.name || form.id, provider: form.provider, model: form.model || undefined,
          config: { timeframes: form.timeframes, webSearch: form.webSearch, style: form.style || undefined, language: 'pl' },
        },
      });
      setForm({ ...form, id: '', name: '', style: '' });
      void agents.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageHeader title="Agenci AI" subtitle="Każdy agent robi research, podejmuje decyzje i jest rozliczany w forward teście. Porównuj modele na tych samych danych." />
      <ErrorBox error={err ?? agents.error} />
      {msg && <div className="mb-4 rounded-lg border border-up/40 bg-up/10 px-4 py-3 text-sm text-up">{msg}</div>}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {(agents.data ?? []).map((a) => (
            <Card
              key={a.id}
              title={
                <span className="text-base text-text">
                  {a.name} <span className="text-xs text-muted">· {a.provider} / {a.model}</span>
                </span>
              }
              right={
                <button onClick={() => toggle(a)} className={`text-xs ${a.enabled ? 'text-up' : 'text-muted'}`}>
                  {a.enabled ? '● aktywny' : '○ wyłączony'}
                </button>
              }
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">Interwały:</span>
                {(a.config.timeframes ?? ['1h', '4h', '1d']).map((t) => (
                  <span key={t} className="rounded bg-white/5 px-2 py-0.5 text-xs">
                    {t}
                  </span>
                ))}
                {a.config.webSearch && <span className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">web search</span>}
                {a.provider === 'external' && <span className="rounded bg-warn/15 px-2 py-0.5 text-xs text-warn">MCP / API</span>}
              </div>
              {a.config.style && <p className="mt-2 text-sm text-muted">{a.config.style}</p>}
              {a.provider !== 'external' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(a.config.timeframes ?? ['1h', '4h', '1d']).map((t) => (
                    <button key={t} disabled={busy === a.id} onClick={() => run(a, t)} className="btn text-xs">
                      {busy === a.id ? 'Analizuje…' : `Uruchom teraz (${t})`}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          ))}

          <Card title="Ostatnie przebiegi">
            <table className="grid-table w-full">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Interwał</th>
                  <th>Status</th>
                  <th className="text-right">Decyzje</th>
                  <th className="text-right">Tokeny we/wy</th>
                  <th className="text-right">Kiedy</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).map((r) => (
                  <tr key={r.id} title={r.error ?? r.summary}>
                    <td>{r.agentId}</td>
                    <td className="text-muted">{r.scope}</td>
                    <td className={r.status === 'ok' ? 'text-up' : r.status === 'error' ? 'text-down' : 'text-warn'}>{r.status}</td>
                    <td className="num text-right">{r.decisions ?? 0}</td>
                    <td className="num text-right text-muted">
                      {r.inputTokens ?? 0} / {r.outputTokens ?? 0}
                    </td>
                    <td className="text-right text-xs text-muted">{ago(r.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Dodaj agenta">
            <div className="space-y-3 text-sm">
              <input className="input w-full" placeholder="id, np. claude-swing" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase() })} />
              <input className="input w-full" placeholder="Nazwa" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="input w-full" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} {p.available ? '' : '(brak klucza)'}
                  </option>
                ))}
                <option value="baseline">Baseline (wskaźniki, bez AI)</option>
              </select>
              <input
                className="input w-full"
                placeholder={`model (domyślnie ${providers.find((p) => p.id === form.provider)?.defaultModel ?? ''})`}
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
              <div className="flex flex-wrap gap-1.5">
                {TFS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, timeframes: form.timeframes.includes(t) ? form.timeframes.filter((x) => x !== t) : [...form.timeframes, t] })}
                    className={`rounded px-2 py-1 text-xs ${form.timeframes.includes(t) ? 'bg-accent text-white' : 'bg-white/5 text-muted'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-muted">
                <input type="checkbox" checked={form.webSearch} onChange={(e) => setForm({ ...form, webSearch: e.target.checked })} /> Model sam szuka newsów w sieci
              </label>
              <textarea
                className="input h-24 w-full"
                placeholder="Profil strategii, np. „swing 2–10 dni, tylko z trendem wyższego interwału, unikaj wejść przed CPI”"
                value={form.style}
                onChange={(e) => setForm({ ...form, style: e.target.value })}
              />
              <button className="btn btn-primary w-full" onClick={create} disabled={!form.id}>
                Dodaj agenta
              </button>
              <p className="text-xs text-muted">Krótkie interwały (1m–15m) z modelem AI szybko zużywają tokeny. Na start polecam 4h i 1d.</p>
            </div>
          </Card>

          <Card title="Podłącz Claude Code / Codex / Gemini CLI (MCP)">
            <div className="space-y-2 text-xs text-muted">
              <p>Agent w terminalu dostaje ten sam brief rynkowy i zapisuje decyzje do forward testu.</p>
              <pre className="overflow-x-auto rounded bg-black/40 p-2 text-[11px] text-text">{`# Claude Code
claude mcp add tivaromarket \\
  -e TIVARO_AGENT_ID=claude-code \\
  -- node /ścieżka/tivaromarket/apps/mcp/src/main.ts

# Codex CLI (~/.codex/config.toml)
[mcp_servers.tivaromarket]
command = "node"
args = ["/ścieżka/tivaromarket/apps/mcp/src/main.ts"]
env = { TIVARO_AGENT_ID = "codex-cli" }

# Gemini CLI (~/.gemini/settings.json)
"mcpServers": { "tivaromarket": {
  "command": "node",
  "args": ["/ścieżka/tivaromarket/apps/mcp/src/main.ts"],
  "env": { "TIVARO_AGENT_ID": "gemini-cli" } } }`}</pre>
              <p>Potem w CLI: „Pobierz get_market_brief dla 4h, zrób research i zapisz decyzje przez submit_decisions”.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
