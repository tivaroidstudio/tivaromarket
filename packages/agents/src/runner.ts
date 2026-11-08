/** Runs an agent over a set of instruments for one timeframe and records its decisions. */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RISK, evaluateRisk, extractJson, simulatePortfolio, toDecision, validateDecisionInput,
  type DecisionInput, type Instrument, type RiskConfig, type RiskState, type Timeframe,
} from '@tivaro/core';
import type { AgentRecord, Store, StoredDecision } from '@tivaro/db';
import { baselineDecide } from './baseline.ts';
import { buildBrief, type MarketBrief } from './context.ts';
import { LLM_PROVIDERS, type Env, type LlmProvider } from './llm.ts';
import { systemPrompt, userPrompt } from './prompt.ts';

export interface RunResult {
  runId: string;
  decisions: StoredDecision[];
  errors: string[];
  marketView?: string;
  inputTokens: number;
  outputTokens: number;
}

export function riskConfig(store: Store): RiskConfig {
  return { ...DEFAULT_RISK, ...store.getSetting<Partial<RiskConfig>>('risk', {}) };
}

/** Current paper-portfolio state for one agent (live decisions only). */
export function riskState(store: Store, agentId: string, risk = riskConfig(store), mode: 'live' | 'replay' = 'live', now = Date.now()): RiskState {
  const initial = store.getSetting<number>('paper.initialEquity', 10_000);
  const sim = simulatePortfolio(store.scored({ agentId, mode }).filter((x) => x.decision.createdAt <= now), { initialEquity: initial, risk });
  const peak = Math.max(initial, ...sim.curve.map((p) => p.equity));
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  const beforeToday = [...sim.curve].reverse().find((p) => p.t < dayStart)?.equity ?? initial;
  const openIds = new Set(sim.trades.filter((t) => t.status === 'open').map((t) => t.decisionId));
  const instruments = new Map(store.instruments().map((i) => [i.id, i]));
  return {
    equity: sim.equity,
    peakEquity: peak,
    dayStartEquity: beforeToday,
    open: sim.trades
      .filter((t) => openIds.has(t.decisionId))
      .map((t) => ({ instrumentId: t.instrumentId, assetClass: instruments.get(t.instrumentId)?.assetClass ?? 'other', notionalPct: t.sizePct })),
  };
}

export async function runAgent(o: {
  store: Store;
  agent: AgentRecord;
  timeframe: Timeframe;
  instruments: Instrument[];
  env: Env;
  now?: number;
  mode?: 'live' | 'replay';
  /** Override for tests. */
  provider?: LlmProvider;
  chunkSize?: number;
}): Promise<RunResult> {
  const { store, agent, timeframe, env } = o;
  const now = o.now ?? Date.now();
  const runId = randomUUID();
  const scope = `${timeframe}`;
  store.startRun({ id: runId, agentId: agent.id, scope });
  const res: RunResult = { runId, decisions: [], errors: [], inputTokens: 0, outputTokens: 0 };
  const risk = riskConfig(store);
  const state = riskState(store, agent.id, risk, o.mode ?? 'live', now);
  const byId = new Map(o.instruments.map((i) => [i.id, i]));
  const chunk = o.chunkSize ?? 8;
  const views: string[] = [];

  try {
    for (let i = 0; i < o.instruments.length; i += chunk) {
      const part = o.instruments.slice(i, i + chunk);
      const brief = buildBrief(store, { instruments: part, timeframe, now, agentId: agent.id, mode: o.mode ?? 'live' });
      const withData = brief.instruments.filter((x) => x.lastPrice !== null);
      if (!withData.length) {
        res.errors.push(`no candles for ${part.map((p) => p.id).join(', ')} @${timeframe}`);
        continue;
      }
      brief.instruments = withData;
      let out: { marketView?: string; decisions?: unknown[] };
      if (agent.provider === 'baseline') {
        out = baselineDecide(brief);
      } else {
        out = await callModel(agent, brief, env, o.provider, res);
      }
      if (out.marketView) views.push(out.marketView);
      for (const raw of out.decisions ?? []) {
        const v = validateDecisionInput({ timeframe, ...(raw as object) });
        if (!v.ok) {
          res.errors.push(`invalid decision: ${v.errors.join('; ')}`);
          continue;
        }
        const inst = byId.get(v.value.instrumentId);
        const b = brief.instruments.find((x) => x.id === v.value.instrumentId);
        if (!inst || !b) {
          res.errors.push(`decision for unknown/out-of-scope instrument ${v.value.instrumentId}`);
          continue;
        }
        res.decisions.push(record(store, v.value, { agent, runId, now, price: b.lastPrice ?? undefined, mode: o.mode, inst, state, risk }));
      }
    }
    store.finishRun(runId, {
      status: res.errors.length && !res.decisions.length ? 'error' : 'ok',
      decisions: res.decisions.length,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      error: res.errors.join('\n') || undefined,
      summary: views.join('\n\n') || undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.errors.push(msg);
    store.finishRun(runId, { status: 'error', error: msg, decisions: res.decisions.length, inputTokens: res.inputTokens, outputTokens: res.outputTokens });
  }
  res.marketView = views.join('\n\n') || undefined;
  return res;
}

async function callModel(agent: AgentRecord, brief: MarketBrief, env: Env, override: LlmProvider | undefined, acc: RunResult) {
  const provider = override ?? LLM_PROVIDERS[agent.provider];
  if (!provider) throw new Error(`unknown provider ${agent.provider}`);
  const missing = provider.requires.filter((k) => !env[k]);
  if (missing.length && !override) throw new Error(`${provider.label}: missing ${missing.join(', ')}`);
  const cfg = agent.config as AgentRecord['config'] & { webSearch?: boolean; language?: 'pl' | 'en' };
  const r = await provider.complete(
    {
      model: agent.model || provider.defaultModel,
      system: systemPrompt({ language: cfg.language, style: cfg.style, webSearch: cfg.webSearch }),
      user: userPrompt(brief),
      maxOutputTokens: cfg.maxOutputTokens ?? 4000,
      temperature: cfg.temperature,
      webSearch: !!cfg.webSearch && provider.supportsWebSearch,
    },
    env,
  );
  acc.inputTokens += r.inputTokens ?? 0;
  acc.outputTokens += r.outputTokens ?? 0;
  const parsed = extractJson(r.text);
  return Array.isArray(parsed) ? { decisions: parsed } : (parsed as { marketView?: string; decisions?: unknown[] });
}

/** Validate → risk-check → store. Shared by agent runs, MCP and the UI. */
export function record(
  store: Store,
  input: DecisionInput,
  m: { agent: Pick<AgentRecord, 'id' | 'model' | 'provider'>; runId?: string; now: number; price?: number; mode?: 'live' | 'replay'; inst: Instrument; state: RiskState; risk: RiskConfig },
): StoredDecision {
  const d = toDecision(input, {
    id: randomUUID(),
    agentId: m.agent.id,
    model: `${m.agent.provider}/${m.agent.model}`,
    createdAt: m.now,
    priceAtDecision: m.price,
    mode: m.mode,
  });
  const verdict = evaluateRisk(d, m.inst.assetClass, m.state, m.risk);
  const stored: StoredDecision = { ...d, runId: m.runId, risk: verdict };
  store.insertDecision(stored);
  if (verdict.approved && verdict.sizePct > 0) {
    m.state.open.push({ instrumentId: d.instrumentId, assetClass: m.inst.assetClass, notionalPct: verdict.sizePct });
  }
  return stored;
}
