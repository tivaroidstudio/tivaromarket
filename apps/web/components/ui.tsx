import type { ReactNode } from 'react';
import { ACTION_LABEL, STATUS_LABEL } from '@/lib/format';

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = '' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const cls =
    action === 'buy' ? 'bg-up/15 text-up' : action === 'sell' ? 'bg-down/15 text-down' : action === 'close' ? 'bg-warn/15 text-warn' : 'bg-white/5 text-muted';
  return <span className={`rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide ${cls}`}>{ACTION_LABEL[action] ?? action}</span>;
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-xs text-muted">–</span>;
  const cls = status === 'open' ? 'text-accent' : status === 'pending' ? 'text-warn' : 'text-muted';
  return <span className={`text-xs ${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Importance({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5" title={`Ważność ${level}/3`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-2 w-2 rounded-sm ${i <= level ? (level === 3 ? 'bg-down' : level === 2 ? 'bg-warn' : 'bg-muted') : 'bg-white/10'}`} />
      ))}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>;
}

export function ErrorBox({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="mb-4 rounded-lg border border-down/40 bg-down/10 px-4 py-3 text-sm text-down">{error}</div>;
}

export function Pills<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${value === o.value ? 'bg-accent text-white' : 'text-muted hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
