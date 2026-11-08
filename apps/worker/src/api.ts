/** REST API for the dashboard and the MCP server. Zero-dependency node:http. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_RISK, TIMEFRAMES, TIMEFRAME_MS, computeStats, groupStats, indicators as I, isTimeframe, simulatePortfolio, technicalSnapshot,
  validateDecisionInput, type RiskConfig, type Timeframe,
} from '@tivaro/core';
import { LLM_PROVIDERS, buildBrief, record, riskConfig, riskState, runAgent } from '@tivaro/agents';
import { sourceStatus, type Env } from '@tivaro/data';
import type { AgentConfig, Store } from '@tivaro/db';
import { activeTimeframes, ingestCandles, ingestFeeds, settle } from './jobs.ts';
import { leaderboard } from './report.ts';
import { replay } from './replay.ts';

type Handler = (ctx: { req: IncomingMessage; url: URL; params: string[]; body: any }) => Promise<unknown> | unknown;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const num = (v: string | null, d?: number) => (v === null || v === '' ? d : Number(v));
const tfParam = (v: string | null, d: Timeframe = '1h'): Timeframe => {
  if (!v) return d;
  if (!isTimeframe(v)) throw new ApiError(400, `bad timeframe ${v}`);
  return v;
};

export function createApi(store: Store, env: Env) {
  const routes: { method: string; re: RegExp; h: Handler }[] = [];
  const on = (method: string, path: string, h: Handler) =>
    routes.push({ method, re: new RegExp(`^${path.replace(/:[a-z]+/gi, '([^/]+)')}$`), h });

  on('GET', '/api/health', () => ({ ok: true, time: Date.now() }));

  on('GET', '/api/overview', () => {
    const instruments = store.instruments();
    return {
      instruments: instruments.length,
      enabledInstruments: instruments.filter((i) => i.enabled).length,
      timeframes: activeTimeframes(store),
      agents: store.agents().length,
      leaderboard: leaderboard(store),
      recentDecisions: store.scored({ limit: 15 }),
      runs: store.runs(10),
      upcoming: store.events({ from: Date.now(), to: Date.now() + 3 * 86_400_000, minImportance: 3, limit: 12 }),
      llmProviders: Object.values(LLM_PROVIDERS).map((p) => ({ id: p.id, label: p.label, available: p.requires.every((k) => env[k]), defaultModel: p.defaultModel })),
    };
  });

  // ---- instruments & market data ----
  on('GET', '/api/instruments', () =>
    store.instruments().map((i) => {
      const c = store.candles(i.id, '1d', { limit: 2 });
      const last = c[c.length - 1];
      const prev = c[c.length - 2];
      return { ...i, last: last?.c ?? null, change1d: last && prev ? last.c / prev.c - 1 : null, lastTime: last?.t ?? null };
    }),
  );
  on('PATCH', '/api/instruments/:id', ({ params, body }) => {
    const id = decodeURIComponent(params[0]);
    if (!store.instrument(id)) throw new ApiError(404, 'instrument not found');
    if (typeof body.enabled === 'boolean') store.setInstrumentEnabled(id, body.enabled);
    return store.instrument(id);
  });
  on('POST', '/api/instruments', ({ body }) => {
    for (const k of ['id', 'symbol', 'name', 'assetClass', 'provider']) if (!body[k]) throw new ApiError(400, `${k} required`);
    store.upsertInstrument(body);
    return store.instrument(body.id);
  });

  on('GET', '/api/candles', ({ url }) => {
    const id = url.searchParams.get('instrumentId');
    if (!id) throw new ApiError(400, 'instrumentId required');
    return store.candles(id, tfParam(url.searchParams.get('tf')), { limit: Math.min(num(url.searchParams.get('limit'), 500)!, 5000) });
  });

  on('GET', '/api/indicators', ({ url }) => {
    const id = url.searchParams.get('instrumentId');
    if (!id) throw new ApiError(400, 'instrumentId required');
    const tf = tfParam(url.searchParams.get('tf'));
    const c = store.candles(id, tf, { limit: Math.min(num(url.searchParams.get('limit'), 500)!, 5000) + 200 });
    const cl = I.closes(c);
    const cut = Math.max(0, c.length - (num(url.searchParams.get('limit'), 500) as number));
    const s = (arr: number[]) => arr.slice(cut).map((v) => (Number.isFinite(v) ? Number(v.toFixed(6)) : null));
    const bb = I.bollinger(cl);
    const m = I.macd(cl);
    const st = I.supertrend(c);
    return {
      t: c.slice(cut).map((x) => x.t),
      ema20: s(I.ema(cl, 20)), ema50: s(I.ema(cl, 50)), ema200: s(I.ema(cl, 200)),
      bbUpper: s(bb.upper), bbLower: s(bb.lower), rsi: s(I.rsi(cl)),
      macd: s(m.macd), macdSignal: s(m.signal), macdHist: s(m.histogram),
      supertrend: s(st.line), supertrendDir: s(st.direction), atr: s(I.atr(c)), vwap: s(I.vwap(c)),
      snapshot: technicalSnapshot(c, tf),
    };
  });

  on('GET', '/api/brief', ({ url }) => {
    const ids = (url.searchParams.get('instrumentIds') ?? '').split(',').filter(Boolean);
    const all = store.instruments(true);
    const instruments = ids.length ? all.filter((i) => ids.includes(i.id)) : all.slice(0, 8);
    return buildBrief(store, { instruments, timeframe: tfParam(url.searchParams.get('tf')), now: Date.now(), agentId: url.searchParams.get('agentId') ?? 'external' });
  });

  on('GET', '/api/news', ({ url }) =>
    store.news({ symbol: url.searchParams.get('symbol') ?? undefined, q: url.searchParams.get('q') ?? undefined, limit: num(url.searchParams.get('limit'), 100), since: num(url.searchParams.get('since'), 0) }),
  );
  on('GET', '/api/events', ({ url }) =>
    store.events({
      from: num(url.searchParams.get('from'), Date.now() - 86_400_000),
      to: num(url.searchParams.get('to'), Date.now() + 14 * 86_400_000),
      minImportance: num(url.searchParams.get('minImportance'), 1),
      kind: url.searchParams.get('kind') ?? undefined,
      limit: num(url.searchParams.get('limit'), 500),
    }),
  );
  on('GET', '/api/onchain', ({ url }) => {
    const key = url.searchParams.get('key');
    return key ? store.onchainSeries(key, num(url.searchParams.get('since'), 0)) : store.onchainLatest(url.searchParams.get('prefix') ?? '');
  });
  on('GET', '/api/whales', ({ url }) =>
    store.whales({ symbol: url.searchParams.get('symbol') ?? undefined, minUsd: num(url.searchParams.get('minUsd'), 0), limit: num(url.searchParams.get('limit'), 100), since: num(url.searchParams.get('since'), 0) }),
  );
  on('GET', '/api/fundamentals/:id', ({ params }) => store.fundamentals(decodeURIComponent(params[0])));
  on('GET', '/api/sources', () => sourceStatus(env));

  // ---- agents ----
  on('GET', '/api/agents', () => store.agents());
  on('POST', '/api/agents', ({ body }) => {
    if (!body.id || !/^[a-z0-9][a-z0-9_-]{1,40}$/.test(body.id)) throw new ApiError(400, 'id: lowercase letters, digits, - and _');
    if (!['baseline', 'external', ...Object.keys(LLM_PROVIDERS)].includes(body.provider)) throw new ApiError(400, 'unknown provider');
    store.upsertAgent({
      id: body.id, name: body.name ?? body.id, provider: body.provider,
      model: body.model ?? LLM_PROVIDERS[body.provider]?.defaultModel ?? body.provider, config: (body.config ?? {}) as AgentConfig, enabled: body.enabled ?? true,
    });
    return store.agent(body.id);
  });
  on('PATCH', '/api/agents/:id', ({ params, body }) => {
    const a = store.agent(params[0]);
    if (!a) throw new ApiError(404, 'agent not found');
    store.upsertAgent({ ...a, ...body, id: a.id, config: { ...a.config, ...(body.config ?? {}) } });
    return store.agent(a.id);
  });
  on('DELETE', '/api/agents/:id', ({ params }) => {
    store.deleteAgent(params[0]);
    return { ok: true };
  });
  on('POST', '/api/agents/:id/run', async ({ params, body }) => {
    const a = store.agent(params[0]);
    if (!a) throw new ApiError(404, 'agent not found');
    if (a.provider === 'external') throw new ApiError(400, 'external agents submit decisions via MCP/API');
    const all = store.instruments(true);
    const ids: string[] = body.instrumentIds ?? a.config.instruments ?? [];
    return runAgent({ store, agent: a, timeframe: tfParam(body.timeframe ?? null, '4h'), instruments: ids.length ? all.filter((i) => ids.includes(i.id)) : all, env });
  });
  on('POST', '/api/replay', async ({ body }) => {
    if (!body.agentId || !body.from || !body.to) throw new ApiError(400, 'agentId, from, to required');
    return replay(store, env, { ...body, timeframe: tfParam(body.timeframe ?? null, '1d') });
  });
  on('GET', '/api/runs', ({ url }) => store.runs(num(url.searchParams.get('limit'), 50), url.searchParams.get('agentId') ?? undefined));

  // ---- decisions & forward test ----
  on('GET', '/api/decisions', ({ url }) => {
    const agentId = url.searchParams.get('agentId') ?? undefined;
    const instrumentId = url.searchParams.get('instrumentId') ?? undefined;
    const mode = url.searchParams.get('mode') ?? 'live';
    const limit = num(url.searchParams.get('limit'), 200)!;
    const scored = new Map(store.scored({ agentId, mode, limit: 100_000 }).map((x) => [x.decision.id, x.result]));
    return store.decisions({ agentId, instrumentId, limit, mode }).map((d) => ({ decision: d, result: scored.get(d.id) ?? null }));
  });
  on('GET', '/api/decisions/:id', ({ params }) => {
    const d = store.decision(params[0]);
    if (!d) throw new ApiError(404, 'not found');
    const r = store.scored({ agentId: d.agentId, mode: d.mode, limit: 100_000 }).find((x) => x.decision.id === d.id)?.result ?? null;
    return { decision: d, result: r, candles: store.candles(d.instrumentId, d.timeframe, { from: d.createdAt - 100 * TIMEFRAME_MS[d.timeframe], limit: 100 + d.horizonBars + 20, first: true }) };
  });
  /** External agents (Claude Code, Codex CLI, Gemini CLI via MCP) and manual entries. */
  on('POST', '/api/decisions', ({ body }) => {
    const agentId = String(body.agentId ?? 'manual');
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(agentId)) throw new ApiError(400, 'bad agentId');
    if (!store.agent(agentId)) store.upsertAgent({ id: agentId, name: body.agentName ?? agentId, provider: 'external', model: body.model ?? 'external', config: {}, enabled: true });
    const agent = store.agent(agentId)!;
    const list = Array.isArray(body.decisions) ? body.decisions : [body];
    const risk = riskConfig(store);
    const state = riskState(store, agentId, risk);
    const now = Date.now();
    const out: unknown[] = [];
    for (const raw of list) {
      const v = validateDecisionInput(raw);
      if (!v.ok) {
        out.push({ error: v.errors });
        continue;
      }
      const inst = store.instrument(v.value.instrumentId);
      if (!inst) {
        out.push({ error: [`unknown instrument ${v.value.instrumentId}`] });
        continue;
      }
      const last = store.candles(inst.id, v.value.timeframe, { limit: 1 })[0];
      out.push(record(store, v.value, { agent: { ...agent, model: body.model ?? agent.model }, now, price: last?.c, inst, state, risk }));
    }
    return out;
  });
  on('POST', '/api/settle', () => ({ updated: settle(store, { all: true }) }));

  on('GET', '/api/leaderboard', ({ url }) => {
    const since = num(url.searchParams.get('since'), 0);
    const mode = (url.searchParams.get('mode') ?? 'live') as 'live' | 'replay';
    const items = store.scored({ since, mode });
    return {
      agents: leaderboard(store, { since, mode }),
      byTimeframe: groupStats(items, (x) => x.decision.timeframe),
      byAssetClass: groupStats(items, (x) => x.assetClass),
      byAgentTimeframe: groupStats(items, (x) => `${x.decision.agentId}|${x.decision.timeframe}`),
    };
  });
  on('GET', '/api/portfolio', ({ url }) => {
    const agentId = url.searchParams.get('agentId');
    if (!agentId) throw new ApiError(400, 'agentId required');
    const mode = url.searchParams.get('mode') ?? 'live';
    const items = store.scored({ agentId, mode });
    const sim = simulatePortfolio(items, { initialEquity: store.getSetting('paper.initialEquity', 10_000), risk: riskConfig(store) });
    return { ...sim, stats: computeStats(items), state: riskState(store, agentId) };
  });

  // ---- settings ----
  on('GET', '/api/settings', () => ({
    risk: riskConfig(store),
    defaultRisk: DEFAULT_RISK,
    timeframes: activeTimeframes(store),
    allTimeframes: TIMEFRAMES,
    paperInitialEquity: store.getSetting('paper.initialEquity', 10_000),
    forwardTest: store.getSetting('forwardTest', { feeBps: 5, slippageBps: 2, holdBandPct: 0.005 }),
  }));
  on('PUT', '/api/settings', ({ body }) => {
    if (body.risk) store.setSetting('risk', { ...riskConfig(store), ...(body.risk as Partial<RiskConfig>) });
    if (Array.isArray(body.timeframes)) store.setSetting('timeframes.active', body.timeframes.filter(isTimeframe));
    if (typeof body.paperInitialEquity === 'number' && body.paperInitialEquity > 0) store.setSetting('paper.initialEquity', body.paperInitialEquity);
    if (body.forwardTest) store.setSetting('forwardTest', body.forwardTest);
    return { ok: true };
  });

  on('POST', '/api/ingest', async ({ body }) => {
    const tf = tfParam(body.timeframe ?? null, '1h');
    const c = await ingestCandles(store, env, tf);
    const feeds = body.feeds ? await ingestFeeds(store, env, { force: true }) : [];
    return { candles: c.total, errors: c.errors.slice(0, 20), feeds };
  });
  on('GET', '/api/logs', ({ url }) => store.logs(num(url.searchParams.get('limit'), 200)));
  on('GET', '/api/reports', () => {
    const rows = store.db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'report.%' ORDER BY key DESC LIMIT 60`).all() as { key: string; value: string }[];
    return rows.map((r) => ({ day: r.key.slice(7), ...JSON.parse(r.value) }));
  });

  const token = env.TIVARO_API_TOKEN;
  const allowOrigin = env.TIVARO_CORS_ORIGIN ?? 'http://localhost:3000';

  return createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', allowOrigin);
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return send(res, 204, null);
    try {
      if (token && !authorized(req.headers.authorization, token)) throw new ApiError(401, 'unauthorized');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!route) throw new ApiError(404, `no route ${req.method} ${url.pathname}`);
      const params = url.pathname.match(route.re)!.slice(1);
      const body = req.method === 'GET' ? {} : await readBody(req);
      send(res, 200, await route.h({ req, url, params, body }));
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      send(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}

function authorized(header: string | undefined, token: string) {
  const got = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 2_000_000) throw new ApiError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid JSON');
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  if (status === 204) return res.end();
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data, (_k, v) => (v === Infinity ? 'Infinity' : typeof v === 'number' && Number.isNaN(v) ? null : v)));
}
