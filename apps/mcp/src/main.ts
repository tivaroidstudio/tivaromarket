#!/usr/bin/env node
/**
 * TivaroMarket MCP server (stdio, JSON-RPC 2.0, zero deps).
 * Lets external agents — Claude Code, Codex CLI, Gemini CLI, Claude Desktop — read the same
 * market brief the built-in agents get and submit decisions into the forward test.
 *
 *   TIVARO_API_URL=http://127.0.0.1:8787 TIVARO_AGENT_ID=claude-code node apps/mcp/src/main.ts
 */
import { createInterface } from 'node:readline';
import { TOOLS, callTool } from './tools.ts';

const PROTOCOL = '2025-06-18';

type Msg = { jsonrpc: '2.0'; id?: number | string | null; method?: string; params?: any };

const write = (m: unknown) => process.stdout.write(JSON.stringify(m) + '\n');
const reply = (id: Msg['id'], result: unknown) => write({ jsonrpc: '2.0', id, result });
const fail = (id: Msg['id'], code: number, message: string) => write({ jsonrpc: '2.0', id, error: { code, message } });

export async function handle(msg: Msg, out: { reply: typeof reply; fail: typeof fail } = { reply, fail }) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification (e.g. notifications/initialized)
  switch (method) {
    case 'initialize':
      return out.reply(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'tivaromarket', version: '0.1.0' },
        instructions:
          'TivaroMarket: multi-asset market research + paper trading with a forward test. Start with get_market_brief, ' +
          'research, then submit_decisions (buy/sell/hold/close with stopLoss/takeProfit). Every decision is scored on future candles; ' +
          'check get_track_record to calibrate.',
      });
    case 'ping':
      return out.reply(id, {});
    case 'tools/list':
      return out.reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      try {
        const result = await callTool(params?.name, params?.arguments ?? {});
        return out.reply(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] });
      } catch (e) {
        return out.reply(id, { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] });
      }
    }
    default:
      return out.fail(id, -32601, `method not found: ${method}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('apps/mcp/src/main.ts')) {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return fail(null, -32700, 'parse error');
    }
    void handle(msg);
  });
}
