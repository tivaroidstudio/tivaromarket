/** Jobs: ingest candles & feeds, settle decisions (forward test), run agents. */
import { settleDecision, TIMEFRAME_MS, type Instrument, type Timeframe } from '@tivaro/core';
import {
  CANDLE_PROVIDERS, DEFAULT_UNIVERSE, FEEDS, OANDA_SYMBOLS, feedSymbols, finnhubFundamentals, onlyClosed, redact,
  type CandleProvider, type Env, type Feed,
} from '@tivaro/data';
import { runAgent } from '@tivaro/agents';
import type { Store } from '@tivaro/db';

export const DEFAULT_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d', '1w'];

export function activeTimeframes(store: Store): Timeframe[] {
  return store.getSetting<Timeframe[]>('timeframes.active', DEFAULT_TIMEFRAMES);
}

export function seed(store: Store) {
  if (store.instruments().length === 0) for (const i of DEFAULT_UNIVERSE) store.upsertInstrument(i);
  if (store.agents().length === 0) {
    store.upsertAgent({
      id: 'baseline',
      name: 'Baseline (wskaźniki, bez AI)',
      provider: 'baseline',
      model: 'rules-v1',
      config: { timeframes: ['1h', '4h', '1d'] },
      enabled: true,
    });
  }
}

/** Pick provider: explicit OANDA mapping when a token exists, otherwise the instrument's own. */
function providersFor(inst: Instrument, env: Env): { p: CandleProvider; inst: Instrument }[] {
  const list: { p: CandleProvider; inst: Instrument }[] = [];
  if (env.OANDA_API_TOKEN && OANDA_SYMBOLS[inst.id]) list.push({ p: CANDLE_PROVIDERS.oanda, inst: { ...inst, providerSymbol: OANDA_SYMBOLS[inst.id] } });
  if (inst.provider === 'yahoo' && (inst.assetClass === 'stock' || inst.assetClass === 'etf') && env.ALPACA_API_KEY_ID && !inst.providerSymbol?.includes('.'))
    list.push({ p: CANDLE_PROVIDERS.alpaca, inst: { ...inst, providerSymbol: inst.symbol } });
  const own = CANDLE_PROVIDERS[inst.provider];
  if (own && own.id !== 'synthetic') list.push({ p: own, inst });
  if (inst.assetClass === 'crypto' && inst.provider === 'binance') list.push({ p: CANDLE_PROVIDERS.bybit, inst });
  if (inst.provider !== 'yahoo' && inst.assetClass !== 'crypto') list.push({ p: CANDLE_PROVIDERS.yahoo, inst });
  return list.filter((x) => x.p.requires.every((k) => env[k]));
}

export async function ingestCandles(store: Store, env: Env, tf: Timeframe, instruments = store.instruments(true)) {
  let total = 0;
  const errors: string[] = [];
  await pool(instruments, 4, async (inst) => {
    const last = store.lastCandleTime(inst.id, tf);
    const since = last ? last - 3 * TIMEFRAME_MS[tf] : undefined;
    for (const { p, inst: pi } of providersFor(inst, env)) {
      try {
        const candles = onlyClosed(await p.fetchCandles(pi, tf, { since, limit: 1000 }, env), tf);
        if (candles.length) total += store.upsertCandles(inst.id, tf, candles);
        return;
      } catch (e) {
        errors.push(`${inst.id}@${tf} via ${p.id}: ${redact(e instanceof Error ? e.message : String(e))}`);
      }
    }
  });
  store.log(`candles:${tf}`, errors.length === 0, errors.length ? errors.slice(0, 10).join('\n') : `${total} candles`);
  return { total, errors };
}

export async function ingestFeeds(store: Store, env: Env, opts: { force?: boolean; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const ctx = { ...feedSymbols(store.instruments(true)), now };
  const all: Feed<unknown>[] = [...FEEDS.news, ...FEEDS.calendar, ...FEEDS.onchain, ...FEEDS.whales] as Feed<unknown>[];
  const ran: string[] = [];
  for (const f of all) {
    if (f.requires.some((k) => !env[k])) continue;
    const key = `feed.last.${f.id}`;
    const last = store.getSetting<number>(key, 0);
    if (!opts.force && now - last < f.everyMinutes * 60_000) continue;
    try {
      const items = await f.fetch(env, ctx);
      const n =
        f.kind === 'news' ? store.upsertNews(items as never)
        : f.kind === 'calendar' ? store.upsertEvents(items as never)
        : f.kind === 'onchain' ? store.upsertOnchain(items as never)
        : f.kind === 'whales' ? store.upsertWhales(items as never)
        : 0;
      store.setSetting(key, now);
      store.log(`feed:${f.id}`, true, `${n} items`);
      ran.push(f.id);
    } catch (e) {
      store.setSetting(key, now - f.everyMinutes * 60_000 + 5 * 60_000); // retry in ~5 min
      store.log(`feed:${f.id}`, false, redact(e instanceof Error ? e.message : String(e)));
    }
  }
  return ran;
}

export async function refreshFundamentals(store: Store, env: Env) {
  if (!env.FINNHUB_API_KEY) return 0;
  let n = 0;
  for (const i of store.instruments(true).filter((x) => x.assetClass === 'stock' && !x.providerSymbol?.includes('.'))) {
    try {
      const f = await finnhubFundamentals(i.symbol, i.id, env);
      if (f) {
        store.upsertFundamentals(f);
        n++;
      }
    } catch (e) {
      store.log('fundamentals', false, `${i.symbol}: ${redact(String(e))}`);
    }
  }
  store.log('fundamentals', true, `${n} updated`);
  return n;
}

/** Forward test: recompute every unsettled decision on the candles that exist now. */
export function settle(store: Store, opts: { now?: number; all?: boolean; quiet?: boolean } = {}) {
  const now = opts.now ?? Date.now();
  const cfg = store.getSetting('forwardTest', { feeBps: 5, slippageBps: 2, holdBandPct: 0.005 });
  const list = store.decisions({ unsettledOnly: !opts.all, limit: 100_000 });
  let changed = 0;
  for (const d of list) {
    const candles = store.candles(d.instrumentId, d.timeframe, { from: d.createdAt, to: now - TIMEFRAME_MS[d.timeframe], limit: d.horizonBars + 5, first: true });
    const r = settleDecision(d, candles, { ...cfg, now });
    store.saveResult(r);
    changed++;
  }
  if (!opts.quiet) store.log('settle', true, `${changed} decisions updated`);
  return changed;
}

/** Default cadence: once per closed bar, but never more than every 15 min for LLM agents. */
export function agentDue(store: Store, agentId: string, provider: string, tf: Timeframe, everyMinutes: number | undefined, now: number) {
  const last = store.lastRunAt(agentId, tf) ?? 0;
  const minGap = (everyMinutes ?? 0) * 60_000 || Math.max(TIMEFRAME_MS[tf], provider === 'baseline' ? 0 : 15 * 60_000);
  const barNow = Math.floor(now / TIMEFRAME_MS[tf]);
  const barLast = Math.floor(last / TIMEFRAME_MS[tf]);
  return now - last >= minGap * 0.95 && barNow > barLast;
}

export async function runDueAgents(store: Store, env: Env, tf: Timeframe, now = Date.now()) {
  const out: { agentId: string; decisions: number; errors: string[] }[] = [];
  const instruments = store.instruments(true);
  for (const a of store.agents().filter((x) => x.enabled && x.provider !== 'external')) {
    const tfs = a.config.timeframes ?? ['1h', '4h', '1d'];
    if (!tfs.includes(tf)) continue;
    if (!agentDue(store, a.id, a.provider, tf, a.config.everyMinutes, now)) continue;
    const scope = a.config.instruments?.length ? instruments.filter((i) => a.config.instruments!.includes(i.id)) : instruments;
    const r = await runAgent({ store, agent: a, timeframe: tf, instruments: scope, env, now });
    out.push({ agentId: a.id, decisions: r.decisions.length, errors: r.errors });
    store.log(`agent:${a.id}:${tf}`, r.errors.length === 0, r.errors.length ? r.errors.slice(0, 5).join('\n') : `${r.decisions.length} decisions`);
  }
  return out;
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(size, q.length) }, async () => {
    while (q.length) await fn(q.shift()!);
  }));
}
