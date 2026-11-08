export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  method?: string;
  body?: string;
}

const UA = 'TivaroMarket/0.1 (+https://github.com/tivaroidstudio/tivaromarket)';

export async function fetchText(url: string, o: FetchOpts = {}): Promise<string> {
  const retries = o.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 15_000);
    try {
      const res = await fetch(url, {
        method: o.method ?? 'GET',
        body: o.body,
        headers: { 'user-agent': UA, accept: 'application/json, text/xml, */*', ...o.headers },
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new HttpError(res.status, `${res.status} ${res.statusText} for ${redact(url)}: ${text.slice(0, 200)}`);
        // Retry only on rate limits / server errors.
        if (res.status === 429 || res.status >= 500) {
          lastErr = err;
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw err;
      }
      return text;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T = unknown>(url: string, o: FetchOpts = {}): Promise<T> {
  return JSON.parse(await fetchText(url, o)) as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hide api keys / tokens in URLs that end up in logs. */
export function redact(url: string): string {
  return url.replace(/((?:api_?key|apikey|token|auth_token|key)=)[^&]+/gi, '$1***');
}

export const qs = (p: Record<string, string | number | undefined | null>) =>
  Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
