/**
 * One loop, ticking every 30 s:
 *  - when a bar closes on an active timeframe → fetch candles → settle → run due agents
 *  - feeds refresh on their own cadence
 *  - daily job (00:10 UTC): full re-settle, fundamentals, daily report snapshot
 */
import { TIMEFRAME_MS, type Timeframe } from '@tivaro/core';
import type { Env } from '@tivaro/data';
import type { Store } from '@tivaro/db';
import { activeTimeframes, ingestCandles, ingestFeeds, refreshFundamentals, runDueAgents, settle } from './jobs.ts';
import { dailyReport } from './report.ts';

const CLOSE_DELAY = 20_000; // give providers time to publish the closed bar

export class Scheduler {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastBar = new Map<Timeframe, number>();
  private store: Store;
  private env: Env;
  constructor(store: Store, env: Env) {
    this.store = store;
    this.env = env;
  }

  start(intervalMs = 30_000) {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  async tick(now = Date.now()) {
    if (this.busy) return;
    this.busy = true;
    try {
      await ingestFeeds(this.store, this.env, { now });
      for (const tf of activeTimeframes(this.store)) {
        const bar = Math.floor((now - CLOSE_DELAY) / TIMEFRAME_MS[tf]);
        if (this.lastBar.get(tf) === bar) continue;
        this.lastBar.set(tf, bar);
        await ingestCandles(this.store, this.env, tf);
        settle(this.store, { now });
        await runDueAgents(this.store, this.env, tf, now);
      }
      const day = new Date(now).toISOString().slice(0, 10);
      const utcMin = new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes();
      if (utcMin >= 10 && this.store.getSetting('daily.last', '') !== day) {
        this.store.setSetting('daily.last', day);
        await ingestFeeds(this.store, this.env, { force: true, now });
        await refreshFundamentals(this.store, this.env);
        settle(this.store, { now, all: true });
        this.store.setSetting(`report.${day}`, dailyReport(this.store, now));
        this.store.log('daily', true, `daily forward-test report ${day}`);
      }
    } catch (e) {
      this.store.log('scheduler', false, e instanceof Error ? e.stack ?? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }
}
