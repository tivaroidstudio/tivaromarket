/**
 * Historical replay ("backtest" an agent on the past). The agent is called at past
 * timestamps and only sees data that existed then (buildBrief filters by `now`).
 * Replay decisions are stored with mode='replay' and never mix with the live record.
 * NOTE: LLMs may have memorised past prices/news — live forward tests are the honest
 * measure; replays are best for the free baseline and for quick sanity checks.
 */
import { TIMEFRAME_MS, type Timeframe } from '@tivaro/core';
import { runAgent } from '@tivaro/agents';
import type { Store } from '@tivaro/db';
import type { Env } from '@tivaro/data';
import { settle } from './jobs.ts';

export async function replay(
  store: Store,
  env: Env,
  o: { agentId: string; timeframe: Timeframe; instrumentIds?: string[]; from: number; to: number; stepBars?: number; maxSteps?: number },
) {
  const agent = store.agent(o.agentId);
  if (!agent) throw new Error(`agent ${o.agentId} not found`);
  const instruments = store.instruments(true).filter((i) => !o.instrumentIds?.length || o.instrumentIds.includes(i.id));
  const step = (o.stepBars ?? 1) * TIMEFRAME_MS[o.timeframe];
  const maxSteps = o.maxSteps ?? (agent.provider === 'baseline' ? 5000 : 50); // protect token budgets
  let steps = 0;
  let decisions = 0;
  const errors: string[] = [];
  for (let t = Math.ceil(o.from / TIMEFRAME_MS[o.timeframe]) * TIMEFRAME_MS[o.timeframe]; t <= o.to && steps < maxSteps; t += step, steps++) {
    settle(store, { now: t, quiet: true }); // results as known at t (no future leakage)
    const r = await runAgent({ store, agent, timeframe: o.timeframe, instruments, env, now: t, mode: 'replay' });
    decisions += r.decisions.length;
    errors.push(...r.errors.slice(0, 2));
  }
  settle(store);
  return { steps, decisions, errors: errors.slice(0, 20) };
}
