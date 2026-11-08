export * from './http.ts';
export * from './candles.ts';
export * from './feeds.ts';
export * from './universe.ts';

import { CANDLE_PROVIDERS, type Env } from './candles.ts';
import { FEEDS } from './feeds.ts';

export interface SourceStatus {
  id: string;
  kind: string;
  label: string;
  requires: string[];
  missing: string[];
  available: boolean;
  notes?: string;
}

/** What is usable right now with the configured keys — shown in the UI and to agents. */
export function sourceStatus(env: Env): SourceStatus[] {
  const missing = (req: string[]) => req.filter((k) => !env[k]);
  const out: SourceStatus[] = Object.values(CANDLE_PROVIDERS)
    .filter((p) => p.id !== 'synthetic')
    .map((p) => ({ id: p.id, kind: 'candles', label: p.label, requires: p.requires, missing: missing(p.requires), available: missing(p.requires).length === 0, notes: p.notes }));
  for (const [kind, feeds] of Object.entries(FEEDS)) {
    for (const f of feeds) out.push({ id: f.id, kind, label: f.label, requires: f.requires, missing: missing(f.requires), available: missing(f.requires).length === 0, notes: f.notes });
  }
  out.push({
    id: 'xtb', kind: 'broker', label: 'XTB (manual execution only)', requires: [], missing: [], available: true,
    notes: 'XTB disabled its xAPI on 2025-03-14. TivaroMarket shows signals marked xtb-manual for you to place in xStation.',
  });
  return out;
}
