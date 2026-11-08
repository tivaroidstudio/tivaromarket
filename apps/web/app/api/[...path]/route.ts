/** Proxies /api/* to the worker. Keeps TIVARO_API_TOKEN on the server side. */
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const API = (process.env.TIVARO_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.TIVARO_API_TOKEN) headers.authorization = `Bearer ${process.env.TIVARO_API_TOKEN}`;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      cache: 'no-store',
    });
    return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
  } catch {
    return Response.json({ error: `Worker niedostępny pod ${API}. Uruchom: pnpm worker` }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
