export const ASSET_LABEL: Record<string, string> = {
  crypto: 'Krypto',
  stock: 'Akcje',
  etf: 'ETF',
  index: 'Indeksy',
  forex: 'Forex',
  commodity: 'Surowce',
  bond: 'Obligacje',
  other: 'Inne',
};

export const ACTION_LABEL: Record<string, string> = { buy: 'KUP', sell: 'SPRZEDAJ', hold: 'TRZYMAJ', close: 'ZAMKNIJ' };

export const STATUS_LABEL: Record<string, string> = {
  pending: 'czeka',
  open: 'otwarta',
  closed: 'zamknięta',
  expired: 'horyzont',
  not_filled: 'niewypełnione',
  skipped: 'pominięta',
};

export const EXIT_LABEL: Record<string, string> = { stop: 'SL', target: 'TP', horizon: 'czas', opposite: 'odwrotny', manual: 'ręcznie' };

export function price(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const d = a >= 1000 ? 2 : a >= 10 ? 2 : a >= 1 ? 4 : 6;
  return v.toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function pct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const s = (v * 100).toFixed(digits).replace('.', ',');
  return `${signed && v > 0 ? '+' : ''}${s}%`;
}

export function num(v: number | null | undefined | string, digits = 2): string {
  if (v === 'Infinity') return '∞';
  if (v === null || v === undefined || typeof v === 'string' || !Number.isFinite(v)) return '–';
  return v.toLocaleString('pl-PL', { maximumFractionDigits: digits });
}

export function money(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return v.toLocaleString('pl-PL', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function dt(ts: number | null | undefined, withTime = true): string {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('pl-PL', withTime ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return '–';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s temu`;
  if (s < 3600) return `${Math.round(s / 60)} min temu`;
  if (s < 86400) return `${Math.round(s / 3600)} h temu`;
  return `${Math.round(s / 86400)} d temu`;
}

export const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? 'text-muted' : v > 0 ? 'text-up' : 'text-down');
