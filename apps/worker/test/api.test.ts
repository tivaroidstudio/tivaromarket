import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { syntheticCandles, TIMEFRAME_MS } from '@tivaro/core';
import { Store } from '@tivaro/db';
import { createApi } from '../src/api.ts';
import { seed, settle } from '../src/jobs.ts';

test('API + MCP end-to-end: brief, external decision, settle, leaderboard', async () => {
  const store = new Store(':memory:');
  seed(store);
  const id = 'crypto:BTCUSDT';
  const now = Date.now();
  const start = Math.floor(now / TIMEFRAME_MS['1h']) * TIMEFRAME_MS['1h'] - 300 * TIMEFRAME_MS['1h'];
  store.upsertCandles(id, '1h', syntheticCandles({ n: 300, timeframe: '1h', start, seed: 9, price: 90000 }));

  const server = createApi(store, { TIVARO_API_TOKEN: 'secret' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(base + path, { ...init, headers: { authorization: 'Bearer secret', 'content-type': 'application/json' } });
    return { status: r.status, body: await r.json() };
  };
  try {
    assert.equal((await fetch(base + '/api/health')).status, 401);
    const brief = await call(`/api/brief?instrumentIds=${id}&tf=1h`);
    assert.equal(brief.status, 200);
    const px = brief.body.instruments[0].lastPrice;
    assert.ok(px > 0);

    // MCP over stdio against the running API
    const mcp = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/mcp/src/main.ts'], {
      env: { ...process.env, TIVARO_API_URL: base, TIVARO_API_TOKEN: 'secret', TIVARO_AGENT_ID: 'codex-cli' },
    });
    const replies: any[] = [];
    let buf = '';
    mcp.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        replies.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
      }
    });
    const send = (m: object) => mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    const waitFor = async (rid: number) => {
      for (let k = 0; k < 200; k++) {
        const r = replies.find((x) => x.id === rid);
        if (r) return r;
        await new Promise((res) => setTimeout(res, 25));
      }
      throw new Error(`no MCP reply ${rid}`);
    };
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    assert.equal((await waitFor(1)).result.serverInfo.name, 'tivaromarket');
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    assert.ok((await waitFor(2)).result.tools.some((t: any) => t.name === 'submit_decisions'));
    send({
      id: 3, method: 'tools/call',
      params: { name: 'submit_decisions', arguments: { model: 'gpt-5-codex', decisions: [{ instrumentId: id, timeframe: '1h', action: 'buy', confidence: 0.7, stopLoss: px * 0.98, takeProfit: px * 1.04, horizonBars: 6, rationale: 'Test z MCP' }] } },
    });
    const r3 = await waitFor(3);
    assert.ok(!r3.result.isError, r3.result.content?.[0]?.text);
    const recorded = JSON.parse(r3.result.content[0].text);
    assert.equal(recorded[0].risk.approved, true);
    mcp.kill();

    // Pretend 10 more hours passed: add candles after the decision and settle.
    const more = syntheticCandles({ n: 10, timeframe: '1h', start: start + 300 * TIMEFRAME_MS['1h'], seed: 10, price: px });
    store.upsertCandles(id, '1h', more);
    settle(store, { now: start + 311 * TIMEFRAME_MS['1h'] });
    const lb = await call('/api/leaderboard');
    const codex = lb.body.agents.find((a: any) => a.agentId === 'codex-cli');
    assert.equal(codex.provider, 'external');
    assert.equal(codex.stats.decisions, 1);
    const dec = await call('/api/decisions?agentId=codex-cli');
    assert.ok(['closed', 'expired'].includes(dec.body[0].result.status));
    const bad = await call('/api/decisions', { method: 'POST', body: JSON.stringify({ agentId: 'x1', instrumentId: id, timeframe: '1h', action: 'moon' }) });
    assert.ok(bad.body[0].error);
  } finally {
    server.close();
    store.close();
  }
});
