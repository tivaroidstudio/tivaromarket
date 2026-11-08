/** TivaroMarket worker: API + scheduler (ingest → forward-test settle → agents). */
import { existsSync } from 'node:fs';
import { Store } from '@tivaro/db';
import { createApi } from './api.ts';
import { seed } from './jobs.ts';
import { Scheduler } from './scheduler.ts';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);

const env = process.env as Record<string, string | undefined>;
const store = new Store(env.TIVARO_DB ?? './data/tivaromarket.db');
seed(store);

const port = Number(env.TIVARO_API_PORT ?? 8787);
const host = env.TIVARO_API_HOST ?? '127.0.0.1';
if (host !== '127.0.0.1' && host !== 'localhost' && !env.TIVARO_API_TOKEN) {
  console.error('Refusing to listen on a public interface without TIVARO_API_TOKEN.');
  process.exit(1);
}
createApi(store, env).listen(port, host, () => console.log(`TivaroMarket API on http://${host}:${port}`));

if (env.TIVARO_SCHEDULER !== 'off') {
  const s = new Scheduler(store, env);
  s.start();
  console.log('Scheduler running (feeds, candles per closed bar, forward-test settle, agents, daily report 00:10 UTC).');
}

const shutdown = () => {
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
