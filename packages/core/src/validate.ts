/** Zero-dependency validation of decisions coming from LLMs, MCP clients or the UI. */
import { isTimeframe, type Action, type Decision, type Timeframe } from './types.ts';

export interface DecisionInput {
  instrumentId: string;
  timeframe: Timeframe;
  action: Action;
  confidence: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  horizonBars?: number;
  sizePct?: number;
  rationale: string;
  evidence?: string[];
  sources?: string[];
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ACTIONS: Action[] = ['buy', 'sell', 'hold', 'close'];
const optNum = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

export function validateDecisionInput(raw: unknown): Validated<DecisionInput> {
  const e: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['decision must be an object'] };
  const r = raw as Record<string, unknown>;
  const action = String(r.action ?? '').toLowerCase() as Action;
  if (!ACTIONS.includes(action)) e.push(`action must be one of ${ACTIONS.join('|')}`);
  if (typeof r.instrumentId !== 'string' || !r.instrumentId) e.push('instrumentId required');
  if (!isTimeframe(r.timeframe)) e.push('timeframe invalid');
  const confidence = Number(r.confidence);
  if (!(confidence >= 0 && confidence <= 1)) e.push('confidence must be 0..1');
  const rationale = typeof r.rationale === 'string' ? r.rationale.trim() : '';
  if (rationale.length < 5) e.push('rationale required');
  const nums: Record<string, number | undefined> = {
    entryPrice: optNum(r.entryPrice),
    stopLoss: optNum(r.stopLoss),
    takeProfit: optNum(r.takeProfit),
    horizonBars: optNum(r.horizonBars),
    sizePct: optNum(r.sizePct),
  };
  for (const [k, v] of Object.entries(nums)) if (v !== undefined && !(Number.isFinite(v) && v >= 0)) e.push(`${k} must be a positive number`);
  if (nums.sizePct !== undefined && nums.sizePct > 1) e.push('sizePct is a fraction 0..1');
  if (e.length) return { ok: false, errors: e };
  const strArr = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 20) : undefined);
  return {
    ok: true,
    value: {
      instrumentId: r.instrumentId as string,
      timeframe: r.timeframe as Timeframe,
      action,
      confidence,
      entryPrice: nums.entryPrice || undefined,
      stopLoss: nums.stopLoss || undefined,
      takeProfit: nums.takeProfit || undefined,
      horizonBars: nums.horizonBars ? Math.round(nums.horizonBars) : undefined,
      sizePct: nums.sizePct,
      rationale: rationale.slice(0, 4000),
      evidence: strArr(r.evidence),
      sources: strArr(r.sources),
    },
  };
}

/** Default horizon if the agent did not set one: roughly "a few days" scaled per timeframe. */
export const DEFAULT_HORIZON: Record<Timeframe, number> = {
  '1m': 60, '5m': 48, '15m': 32, '30m': 24, '1h': 24, '4h': 18, '1d': 10, '1w': 6,
};

export function toDecision(
  input: DecisionInput,
  meta: { id: string; agentId: string; model?: string; createdAt: number; priceAtDecision?: number; mode?: 'live' | 'replay' },
): Decision {
  return {
    ...input,
    horizonBars: input.horizonBars ?? DEFAULT_HORIZON[input.timeframe],
    id: meta.id,
    agentId: meta.agentId,
    model: meta.model,
    createdAt: meta.createdAt,
    priceAtDecision: meta.priceAtDecision,
    mode: meta.mode ?? 'live',
  };
}

/** Pull the first JSON object/array out of an LLM reply (handles ```json fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('no JSON found in model output');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error('unterminated JSON in model output');
}
